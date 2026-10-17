import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { Audience, Mood } from '@storyquest/contracts';
import { api, toApiError } from '../api';
import {
  AUDIENCES,
  MOODS,
  PROMPT_LIMITS,
  audienceFact,
  audienceLabel,
  checkPromptText,
  moodLabel,
} from '../story/format';
import { messageForError } from '../story/messages';
import { DISPLAY_FONT, colors, radii, screen, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { useBackHandler } from '../hooks/useBackHandler';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { MicHint, PromptField } from '../components/PromptField';
import { SparksSheet } from '../components/sparks/SparksSheet';
import { WalletText } from '../components/sparks/WalletText';
import { canAfford, costLabel, useSparks } from '../purchases';
import type { ScreenNavigation } from '../navigation/types';

const MAX_MOODS = 3;

export default function CreateScreen() {
  const navigation = useNavigation<ScreenNavigation<'Create'>>();
  const isFocused = useIsFocused();
  const [prompt, setPrompt] = useState('');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [audience, setAudience] = useState<Audience>('family');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsSparks, setNeedsSparks] = useState(false);
  const busy = useRef(false);
  const { wallet } = useSparks();
  const storyCost = wallet?.sceneCost ?? 1;

  useBackHandler(() => {
    if (needsSparks) setNeedsSparks(false);
    else navigation.goBack();
  }, isFocused);

  const changePrompt = useCallback((text: string) => {
    setPrompt(text);
    setError(null);
  }, []);

  const toggleMood = useCallback((mood: Mood) => {
    setMoods((current) => {
      if (current.includes(mood)) return current.filter((m) => m !== mood);
      return current.length >= MAX_MOODS ? [...current.slice(1), mood] : [...current, mood];
    });
  }, []);

  const pickAudience = useCallback((value: Audience) => setAudience(value), []);

  const start = useCallback(async () => {
    if (busy.current) return;
    const check = checkPromptText(prompt, PROMPT_LIMITS.min, PROMPT_LIMITS.max);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (!canAfford(wallet, storyCost)) {
      setNeedsSparks(true);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const story = await api.startStory({ kind: 'custom', prompt: check.text, moods, audience });
      navigation.replace('Story', {
        storyId: story.id,
        title: story.title,
        nodeId: story.currentNodeId,
        posterUrl: null,
        origin: { ideaId: null, prompt: check.text, moods, audience },
      });
    } catch (e) {
      const code = toApiError(e).code;
      if (code === 'payment_required') setNeedsSparks(true);
      else setError(messageForError(code, 'start'));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [prompt, moods, audience, navigation, wallet, storyCost]);

  const closeSparks = useCallback(() => setNeedsSparks(false), []);
  const sparksDone = useCallback(() => {
    setNeedsSparks(false);
    start();
  }, [start]);

  const cost = costLabel(wallet, storyCost);

  return (
    <>
      <SpatialNavigationRoot isActive={isFocused && !needsSparks}>
        <View style={styles.screen}>
          <View style={styles.header}>
            <Brand />
            <WalletText />
          </View>

          <View style={styles.page} accessible accessibilityLabel={`Your story. ${prompt.trim() || 'No idea yet'}`}>
            <Text style={styles.pageLabel}>Your story</Text>
            <Text style={[styles.pageTitle, !prompt.trim() && styles.pageEmpty]} numberOfLines={7}>
              {prompt.trim() || 'Your idea shows up here as you speak or type.'}
            </Text>
            <View style={styles.pageFacts}>
              {[...moods.map(moodLabel), audienceFact(audience)].map((fact) => (
                <Text key={fact} style={styles.pageFact}>
                  {fact}
                </Text>
              ))}
            </View>
          </View>

          <View style={styles.column}>
            <Text style={styles.title}>Make your own</Text>
            <Text style={styles.subtitle}>Describe a story and we film the first scene for your family.</Text>

            <DefaultFocus>
              <PromptField
                label="Story idea"
                value={prompt}
                onChangeText={changePrompt}
                placeholder="A shy dragon who opens a bakery"
                maxLength={PROMPT_LIMITS.max}
              />
            </DefaultFocus>
            <MicHint text="Press the microphone button on your remote and say your idea" />

            <Text style={styles.section}>Mood</Text>
            <SpatialNavigationView direction="horizontal" style={styles.row}>
              {MOODS.map((mood) => (
                <Chip
                  key={mood}
                  group="Mood"
                  value={mood}
                  label={moodLabel(mood)}
                  selected={moods.includes(mood)}
                  onToggle={toggleMood}
                />
              ))}
            </SpatialNavigationView>

            <Text style={styles.section}>Who is watching</Text>
            <SpatialNavigationView direction="horizontal" style={styles.row}>
              {AUDIENCES.map((value) => (
                <Chip
                  key={value}
                  group="Who is watching"
                  value={value}
                  label={audienceLabel(value)}
                  selected={audience === value}
                  onToggle={pickAudience}
                />
              ))}
            </SpatialNavigationView>

            <View style={styles.actions}>
              <Button
                label={submitting ? 'Starting the story' : 'Start the story'}
                hint={cost ?? undefined}
                primary
                onSelect={start}
              />
              {cost ? <Text style={styles.cost}>{cost}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          </View>
        </View>
      </SpatialNavigationRoot>
      {needsSparks && <SparksSheet active={isFocused} onDone={sparksDone} onClose={closeSparks} />}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: screen.top,
    left: screen.side,
    right: screen.side,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  column: {
    position: 'absolute',
    top: scaledPixels(156),
    left: screen.side,
    width: scaledPixels(1100),
  },
  title: {
    ...type.title,
    color: colors.paper,
  },
  page: {
    position: 'absolute',
    top: scaledPixels(300),
    right: screen.side,
    width: scaledPixels(500),
    minHeight: scaledPixels(420),
    padding: space.xl,
    borderRadius: radii.plate,
    backgroundColor: colors.paper,
  },
  pageLabel: {
    ...type.small,
    color: colors.inkLine,
  },
  pageTitle: {
    fontFamily: DISPLAY_FONT,
    fontSize: scaledPixels(40),
    lineHeight: scaledPixels(50),
    letterSpacing: -0.5,
    color: colors.ink,
    marginTop: space.sm,
  },
  pageEmpty: {
    color: colors.inkLine,
  },
  pageFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.lg,
  },
  pageFact: {
    ...type.small,
    color: colors.inkLine,
    marginRight: space.md,
  },
  subtitle: {
    ...type.body,
    color: colors.paperDim,
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  section: {
    ...type.label,
    fontWeight: '400',
    color: colors.paperDim,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  row: {
    flexWrap: 'nowrap',
  },
  actions: {
    marginTop: space.xl,
  },
  cost: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.sm,
  },
  error: {
    ...type.body,
    color: colors.paper,
    marginTop: space.sm,
  },
});
