import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import { CUSTOM_CHOICE_LIMITS } from '../../story/format';
import { colors, radii, screen, space, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Button } from '../Button';
import { Icon } from '../Icons';
import { MicHint, PromptField } from '../PromptField';
import { WalletText } from '../sparks/WalletText';

function useFadeIn(): Animated.Value {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return opacity;
}

interface PauseMenuProps {
  title: string;
  active: boolean;
  restarting: boolean;
  onResume: () => void;
  onStartOver: () => void;
  onExit: () => void;
}

export function PauseMenu({ title, active, restarting, onResume, onStartOver, onExit }: PauseMenuProps) {
  const opacity = useFadeIn();
  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.cover, { opacity }]}>
        <View style={styles.sheet}>
          <Text style={styles.small}>Paused</Text>
          <Text style={styles.sheetTitle} numberOfLines={2}>
            {title}
          </Text>
          <SpatialNavigationView direction="vertical" style={styles.buttons}>
            <DefaultFocus>
              <Button label="Resume" primary icon="play" onSelect={onResume} block style={styles.button} />
            </DefaultFocus>
            <Button
              label={restarting ? 'Starting over' : 'Start over'}
              icon="restart"
              onSelect={onStartOver}
              block
              style={styles.button}
            />
            <Button label="Home" icon="home" onSelect={onExit} block style={styles.button} />
          </SpatialNavigationView>
        </View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

interface CustomChoiceSheetProps {
  active: boolean;
  text: string;
  error: string | null;
  costText: string | null;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function CustomChoiceSheet({
  active,
  text,
  error,
  costText,
  onChangeText,
  onSubmit,
  onCancel,
}: CustomChoiceSheetProps) {
  const opacity = useFadeIn();
  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.panel, { opacity }]}>
        <View style={styles.panelTop}>
          <Text style={styles.panelTitle}>What should happen next?</Text>
          <WalletText />
        </View>
        <DefaultFocus>
          <PromptField
            label="Your idea for the next scene"
            value={text}
            onChangeText={onChangeText}
            placeholder="The fox finds a tiny dragon in the snow"
            maxLength={CUSTOM_CHOICE_LIMITS.max}
            onSubmit={onSubmit}
            openOnMount
          />
        </DefaultFocus>
        <MicHint text="Press the microphone button on your remote and say what happens" />
        <View style={styles.panelActions}>
          <SpatialNavigationView direction="horizontal">
            <Button
              label="Use this idea"
              primary
              onSelect={onSubmit}
              hint={costText ?? undefined}
              style={styles.inline}
            />
            <Button label="Back to choices" icon="back" onSelect={onCancel} style={styles.inline} />
          </SpatialNavigationView>
        </View>
        {costText || error ? <Text style={styles.note}>{error ?? costText}</Text> : null}
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

interface StoryErrorPanelProps {
  message: string;
  active: boolean;
  onRetry: () => void;
}

export function StoryErrorPanel({ message, active, onRetry }: StoryErrorPanelProps) {
  const opacity = useFadeIn();
  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.cover, { opacity }]}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>The story stopped</Text>
          <Text style={styles.body}>{message}</Text>
          <View style={styles.buttons}>
            <DefaultFocus>
              <Button label="Try again" primary icon="restart" onSelect={onRetry} block style={styles.button} />
            </DefaultFocus>
          </View>
        </View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

export const PausedBadge = React.memo(() => (
  <View pointerEvents="none" style={styles.pausedWrap}>
    <View style={styles.paused}>
      <Icon name="pause" size={32} />
      <Text style={styles.pausedText}>Paused</Text>
    </View>
  </View>
));

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    width: scaledPixels(720),
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    borderRadius: radii.card,
    backgroundColor: colors.inkRaised,
  },
  small: {
    ...type.label,
    fontWeight: '400',
    color: colors.paperDim,
  },
  sheetTitle: {
    ...type.title,
    color: colors.paper,
    marginTop: space.xs,
  },
  body: {
    ...type.body,
    color: colors.paper,
    marginTop: space.sm,
  },
  buttons: {
    marginTop: space.lg,
    alignSelf: 'stretch',
  },
  button: {
    marginTop: space.sm,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: scaledPixels(256),
    paddingTop: space.xl,
    paddingBottom: screen.top,
    backgroundColor: colors.scrim,
  },
  panelTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  panelTitle: {
    ...type.title,
    color: colors.paper,
  },
  panelActions: {
    flexDirection: 'row',
    marginTop: space.lg,
  },
  inline: {
    marginRight: space.md,
  },
  note: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.sm,
  },
  pausedWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paused: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.card,
    backgroundColor: colors.scrim,
  },
  pausedText: {
    ...type.bodyStrong,
    color: colors.paper,
    marginLeft: space.sm,
  },
});
