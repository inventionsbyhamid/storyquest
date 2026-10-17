import type { ReportReason } from '@storyquest/contracts';

export const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'scary', label: 'It was scary' },
  { reason: 'inappropriate', label: 'It was not suitable' },
  { reason: 'broken', label: 'It did not play right' },
  { reason: 'other', label: 'Something else' },
];

const reported = new Set<string>();

// Scenes reported on this TV since the app opened; their paths stay closed in every story.
export function markReported(nodeId: string): void {
  reported.add(nodeId);
}

export function reportedNodeIds(): string[] {
  return Array.from(reported);
}

export function resetReports(): void {
  reported.clear();
}
