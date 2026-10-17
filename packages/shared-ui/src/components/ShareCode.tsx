import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radii, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export const ShareCode = React.memo(({ url }: { url: string }) => (
  <View style={styles.wrap} accessible accessibilityLabel={`QR code to share your story. ${displayUrl(url)}`}>
    <View style={styles.card}>
      <QRCode value={url} size={scaledPixels(300)} color={colors.background} backgroundColor="#FFFFFF" ecl="M" />
    </View>
    <Text style={styles.title}>Scan to share your story</Text>
    <Text style={styles.url} numberOfLines={1}>
      {displayUrl(url)}
    </Text>
  </View>
));

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  card: {
    padding: scaledPixels(26),
    borderRadius: radii.lg,
    backgroundColor: '#FFFFFF',
  },
  title: {
    ...type.label,
    color: colors.text,
    marginTop: scaledPixels(24),
  },
  url: {
    ...type.meta,
    fontWeight: '500',
    color: colors.textFaint,
    marginTop: scaledPixels(6),
    maxWidth: scaledPixels(420),
  },
});
