import type { Audience } from '../../domain';

export interface SafetyContext {
  source: 'input' | 'output';
  audience: Audience;
}

export interface SafetyVerdict {
  ok: boolean;
  reason?: string;
}

export interface SafetyChecker {
  readonly name: string;
  check(text: string, context: SafetyContext): Promise<SafetyVerdict>;
}
