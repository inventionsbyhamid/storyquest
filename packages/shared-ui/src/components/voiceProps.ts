export interface VoiceTarget {
  position?: number;
  altLabels?: string[];
}

// Vega adds extra props for on screen voice navigation; other platforms only need the label.
export function voiceProps(_target: VoiceTarget): Record<string, unknown> {
  return {};
}
