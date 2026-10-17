import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { colors, radii, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable, FocusGlow } from './Focusable';
import { MicIcon } from './Icons';

interface PromptFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  maxLength: number;
  onSubmit?: () => void;
  openOnMount?: boolean;
}

export function PromptField({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  onSubmit,
  openOnMount,
}: PromptFieldProps) {
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => inputRef.current?.blur());
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!openOnMount) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [openOnMount]);

  const open = useCallback(() => inputRef.current?.focus(), []);

  const handleSubmit = useCallback(() => {
    inputRef.current?.blur();
    onSubmit?.();
  }, [onSubmit]);

  const handleKeyPress = useCallback((event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (event.nativeEvent.key === 'Escape') inputRef.current?.blur();
  }, []);

  return (
    <Focusable
      label={label}
      hint={`${value || placeholder}. Press select to type, or press the microphone button and speak`}
      onSelect={open}
    >
      {(focused) => (
        <View style={[styles.field, (focused || editing) && styles.fieldFocused]}>
          {focused && !editing && <FocusGlow radius={radii.md} />}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            maxLength={maxLength}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            onKeyPress={handleKeyPress}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            selectionColor={colors.accent}
            underlineColorAndroid="transparent"
            accessibilityLabel={label}
            style={styles.input}
          />
          <Text style={styles.counter}>
            {value.length} of {maxLength}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

export const MicHint = React.memo(({ text }: { text: string }) => (
  <View style={styles.hint}>
    <View style={styles.micBadge}>
      <MicIcon size={scaledPixels(30)} color={colors.textOnAccent} />
    </View>
    <Text style={styles.hintText}>{text}</Text>
  </View>
));

const styles = StyleSheet.create({
  field: {
    minHeight: scaledPixels(120),
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border,
    paddingHorizontal: scaledPixels(32),
    paddingTop: scaledPixels(22),
    paddingBottom: scaledPixels(14),
    justifyContent: 'center',
  },
  fieldFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceHigh,
  },
  input: {
    ...type.bodyLarge,
    fontSize: scaledPixels(34),
    lineHeight: undefined,
    color: colors.text,
    padding: 0,
    minHeight: scaledPixels(48),
  },
  counter: {
    ...type.meta,
    color: colors.textFaint,
    alignSelf: 'flex-end',
    marginTop: scaledPixels(6),
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(20),
  },
  micBadge: {
    width: scaledPixels(56),
    height: scaledPixels(56),
    borderRadius: scaledPixels(28),
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scaledPixels(18),
  },
  hintText: {
    ...type.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
});
