import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import { CUSTOM_CHOICE_LIMITS } from '../../story/format';
import { colors, radii, safeZones, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Button } from '../Button';
import { Gradient } from '../Gradient';
import { PauseIcon, PlayIcon, SparkleIcon } from '../Icons';
import { MicHint, PromptField } from '../PromptField';
import { SparksPill } from '../sparks/SparksPill';

const SHEET_SCRIM = [
  { offset: 0, color: colors.background, opacity: 0 },
  { offset: 0.3, color: colors.background, opacity: 0.85 },
  { offset: 1, color: colors.background, opacity: 0.97 },
];

interface PauseMenuProps {
  title: string;
  active: boolean;
  restarting: boolean;
  onResume: () => void;
  onStartOver: () => void;
  onExit: () => void;
}

export function PauseMenu({ title, active, restarting, onResume, onStartOver, onExit }: PauseMenuProps) {
  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.dim}>
        <View style={styles.menu}>
          <View style={styles.menuIcon}>
            <PauseIcon size={scaledPixels(40)} color={colors.textOnAccent} />
          </View>
          <Text style={styles.menuEyebrow}>Paused</Text>
          <Text style={styles.menuTitle} numberOfLines={2}>
            {title}
          </Text>
          <SpatialNavigationView direction="vertical" style={styles.menuButtons}>
            <DefaultFocus>
              <Button
                label="Resume"
                variant="primary"
                onSelect={onResume}
                icon={(color) => <PlayIcon size={scaledPixels(30)} color={color} />}
                block
                style={styles.menuButton}
              />
            </DefaultFocus>
            <Button
              label={restarting ? 'Starting over' : 'Start over'}
              onSelect={onStartOver}
              block
              style={styles.menuButton}
            />
            <Button label="Exit to Home" onSelect={onExit} block style={styles.menuButton} />
          </SpatialNavigationView>
        </View>
      </View>
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
  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.sheetWrap}>
        <Gradient style={StyleSheet.absoluteFill} direction="down" stops={SHEET_SCRIM} />
        <View style={styles.sheet}>
          <View style={styles.sheetTop}>
            <Text style={styles.sheetEyebrow}>Something else</Text>
            <SparksPill />
          </View>
          <Text style={styles.sheetTitle}>What should happen next?</Text>
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
          <MicHint text="Press the microphone button on your remote and say what happens next" />
          <View style={styles.sheetActions}>
            <SpatialNavigationView direction="horizontal">
              <Button
                label="Make it happen"
                detail={costText ?? undefined}
                variant="primary"
                onSelect={onSubmit}
                icon={(color) => <SparkleIcon size={scaledPixels(30)} color={color} />}
                style={styles.sheetButton}
              />
              <Button label="Back to choices" onSelect={onCancel} style={styles.sheetButton} />
            </SpatialNavigationView>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

interface StoryErrorPanelProps {
  message: string;
  active: boolean;
  onRetry: () => void;
  onExit: () => void;
}

export function StoryErrorPanel({ message, active, onRetry, onExit }: StoryErrorPanelProps) {
  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.dim}>
        <View style={styles.menu}>
          <Text style={styles.menuTitle}>The story got stuck</Text>
          <Text style={styles.errorBody}>{message}</Text>
          <SpatialNavigationView direction="vertical" style={styles.menuButtons}>
            <DefaultFocus>
              <Button label="Try again" variant="primary" onSelect={onRetry} block style={styles.menuButton} />
            </DefaultFocus>
            <Button label="Exit to Home" onSelect={onExit} block style={styles.menuButton} />
          </SpatialNavigationView>
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

export const PausedBadge = React.memo(() => (
  <View pointerEvents="none" style={styles.pausedWrap}>
    <View style={styles.pausedBadge}>
      <PlayIcon size={scaledPixels(56)} color={colors.textOnAccent} />
    </View>
    <Text style={styles.pausedText}>Paused. Press play to keep watching</Text>
  </View>
));

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    width: scaledPixels(760),
    paddingHorizontal: scaledPixels(64),
    paddingVertical: scaledPixels(56),
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundRaised,
    borderWidth: scaledPixels(2),
    borderColor: colors.border,
    alignItems: 'center',
  },
  menuIcon: {
    width: scaledPixels(80),
    height: scaledPixels(80),
    borderRadius: scaledPixels(40),
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuEyebrow: {
    ...type.meta,
    color: colors.accent,
    letterSpacing: scaledPixels(2),
    textTransform: 'uppercase',
    marginTop: scaledPixels(22),
  },
  menuTitle: {
    ...type.heading,
    color: colors.text,
    textAlign: 'center',
    marginTop: scaledPixels(8),
  },
  menuButtons: {
    marginTop: scaledPixels(28),
    alignSelf: 'stretch',
  },
  menuButton: {
    marginTop: scaledPixels(18),
  },
  errorBody: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: scaledPixels(16),
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '82%',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: scaledPixels(safeZones.titleSafe.horizontal + 160),
    paddingBottom: scaledPixels(safeZones.titleSafe.vertical + 24),
  },
  sheetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetEyebrow: {
    ...type.meta,
    color: colors.accent,
    letterSpacing: scaledPixels(2),
    textTransform: 'uppercase',
  },
  sheetTitle: {
    ...type.title,
    color: colors.text,
    marginTop: scaledPixels(6),
    marginBottom: scaledPixels(30),
  },
  sheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(36),
  },
  sheetButton: {
    marginRight: scaledPixels(24),
  },
  error: {
    ...type.body,
    color: colors.danger,
    marginLeft: scaledPixels(16),
    flexShrink: 1,
  },
  pausedWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedBadge: {
    width: scaledPixels(128),
    height: scaledPixels(128),
    borderRadius: scaledPixels(64),
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: scaledPixels(8),
  },
  pausedText: {
    ...type.body,
    color: colors.text,
    marginTop: scaledPixels(20),
    paddingHorizontal: scaledPixels(24),
    paddingVertical: scaledPixels(8),
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    overflow: 'hidden',
  },
});
