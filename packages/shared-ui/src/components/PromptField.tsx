import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  TextStyle,
  View,
} from 'react-native';
import { colors, radii, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable } from './Focusable';
import { Icon } from './Icons';

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
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.paperDim}
            maxLength={maxLength}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            onKeyPress={handleKeyPress}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            selectionColor={colors.marigold}
            underlineColorAndroid="transparent"
            accessibilityLabel={label}
            style={[styles.input, WEB_INPUT]}
          />
          <Text style={styles.counter}>
            {value.length} of {maxLength}
          </Text>
        </View>
      )}
    </Focusable>
  );
}

// The field already shows focus with its border; the browser's own outline would double it.
const WEB_INPUT = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as unknown as TextStyle;

export const MicHint = React.memo(({ text }: { text: string }) => (
  <View style={styles.hint}>
    <Icon name="mic" size={28} color={colors.paperDim} />
    <Text style={styles.hintText}>{text}</Text>
  </View>
));

const styles = StyleSheet.create({
  field: {
    minHeight: scaledPixels(112),
    borderRadius: radii.card,
    backgroundColor: colors.inkRaised,
    borderWidth: scaledPixels(2),
    borderColor: colors.inkLine,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
    justifyContent: 'center',
  },
  fieldFocused: {
    borderColor: colors.marigold,
  },
  input: {
    fontSize: scaledPixels(32),
    color: colors.paper,
    padding: 0,
    minHeight: scaledPixels(46),
  },
  counter: {
    ...type.small,
    color: colors.paperDim,
    alignSelf: 'flex-end',
    marginTop: space.xs,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
  },
  hintText: {
    ...type.body,
    color: colors.paperDim,
    marginLeft: space.sm,
    flexShrink: 1,
  },
});
