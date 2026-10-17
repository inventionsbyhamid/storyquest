import { ApplyGuardrailCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '../../log';
import type { SafetyChecker, SafetyContext, SafetyVerdict } from './types';

export interface GuardrailsOptions {
  region: string;
  guardrailId: string;
  guardrailVersion: string;
  bearerToken?: string;
}

const TIMEOUT_MS = 8_000;

/**
 * Runs the local word list first (free and instant), then Bedrock Guardrails.
 * If Guardrails cannot be reached the word list verdict stands, so an AWS
 * hiccup does not block every family's custom choice.
 */
export class GuardrailsSafety implements SafetyChecker {
  readonly name = 'guardrails';
  private readonly client: BedrockRuntimeClient;

  constructor(
    private readonly options: GuardrailsOptions,
    private readonly local: SafetyChecker,
    private readonly log: Logger,
  ) {
    this.client = new BedrockRuntimeClient({
      region: options.region,
      maxAttempts: 2,
      ...(options.bearerToken
        ? { token: { token: options.bearerToken }, authSchemePreference: ['httpBearerAuth'] }
        : {}),
    });
  }

  async check(text: string, context: SafetyContext): Promise<SafetyVerdict> {
    const local = await this.local.check(text, context);
    if (!local.ok) return local;

    try {
      const response = await this.client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: this.options.guardrailId,
          guardrailVersion: this.options.guardrailVersion,
          source: context.source === 'input' ? 'INPUT' : 'OUTPUT',
          content: [{ text: { text } }],
        }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (response.action === 'GUARDRAIL_INTERVENED') return { ok: false, reason: 'guardrail' };
      return { ok: true };
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'guardrails check failed, using the word list verdict');
      return local;
    }
  }
}
