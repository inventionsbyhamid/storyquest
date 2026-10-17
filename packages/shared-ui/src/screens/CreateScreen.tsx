import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { Audience, Mood } from '@storyquest/contracts';
import { api, toApiError } from '../api';
import { AUDIENCES, MOODS, PROMPT_LIMITS, audienceLabel, checkPromptText, moodLabel } from '../story/format';
import { messageForError } from '../story/messages';
import { colors, safeZones, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { useBackHandler } from '../hooks/useBackHandler';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Gradient } from '../components/Gradient';
import { SparkleIcon } from '../components/Icons';
import { MicHint, PromptField } from '../components/PromptField';
import { WaitingDots } from '../components/WaitingDots';
import { Wordmark } from '../components/Wordmark';
import type { ScreenNavigation } from '../navigation/types';

const MAX_MOODS = 3;
const SIDE = scaledPixels(safeZones.titleSafe.horizontal);

const GLOW = [
  { offset: 0, color: colors.secondary, opacity: 0.32 },
  { offset: 0.6, color: colors.secondary, opacity: 0.08 },
  { offset: 1, color: colors.secondary, opacity: 0 },
];

export default function CreateScreen() {
  const navigation = useNavigation<ScreenNavigation<'Create'>>();
  const isFocused = useIsFocused();
  const [prompt, setPrompt] = useState('');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [audience, setAudience] = useState<Audience>('family');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  useBackHandler(() => navigation.goBack(), isFocused);

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
      setError(messageForError(toApiError(e).code, 'start'));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [prompt, moods, audience, navigation]);

  return (
    <SpatialNavigationRoot isActive={isFocused}>
      <View style={styles.screen}>
        <Gradient style={styles.glow} direction="left" stops={GLOW} />
        <View style={styles.decor} pointerEvents="none">
          <SparkleIcon size={scaledPixels(360)} color="rgba(140, 123, 255, 0.28)" />
        </View>

        <View style={styles.header}>
          <Wordmark size={30} />
        </View>

        <View style={styles.column}>
          <Text style={styles.title}>Make your own</Text>
          <Text style={styles.subtitle}>
            Tell us what you feel like watching. We will film the first scene just for you.
          </Text>

          <DefaultFocus>
            <PromptField
              label="Story idea"
              value={prompt}
              onChangeText={changePrompt}
              placeholder="A shy dragon who opens a bakery"
              maxLength={PROMPT_LIMITS.max}
            />
          </DefaultFocus>
          <MicHint text="Press the microphone button on your remote and tell us what you feel like watching" />

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
              label={submitting ? 'Starting your story' : 'Start the story'}
              variant="primary"
              onSelect={start}
              icon={(color) =>
                submitting ? (
                  <WaitingDots color={color} size={10} />
                ) : (
                  <SparkleIcon size={scaledPixels(30)} color={color} />
                )
              }
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '55%',
  },
  decor: {
    position: 'absolute',
    right: scaledPixels(160),
    top: scaledPixels(300),
  },
  header: {
    position: 'absolute',
    top: scaledPixels(safeZones.titleSafe.vertical),
    left: SIDE,
  },
  column: {
    position: 'absolute',
    top: scaledPixels(140),
    left: SIDE,
    width: scaledPixels(1180),
  },
  title: {
    ...type.title,
    color: colors.text,
  },
  subtitle: {
    ...type.body,
    color: colors.textMuted,
    marginTop: scaledPixels(10),
    marginBottom: scaledPixels(30),
  },
  section: {
    ...type.meta,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: scaledPixels(2),
    marginTop: scaledPixels(40),
    marginBottom: scaledPixels(16),
  },
  row: {
    flexWrap: 'nowrap',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(48),
  },
  error: {
    ...type.body,
    color: colors.danger,
    marginLeft: scaledPixels(32),
    flexShrink: 1,
  },
});
