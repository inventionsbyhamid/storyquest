interface VoiceTarget {
  position?: number;
  altLabels?: string[];
}

// "Alexa, select number two" uses ariaPosInSet; keplerAltLabels adds extra names to say.
export function voiceProps({ position, altLabels }: VoiceTarget): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (position !== undefined) props.ariaPosInSet = position;
  if (altLabels && altLabels.length > 0) props.keplerAltLabels = altLabels;
  return props;
}
