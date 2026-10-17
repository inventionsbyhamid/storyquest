import { z } from 'zod';

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: int(8080, 1, 65535),
    HOST: z.string().min(1).default('0.0.0.0'),
    PUBLIC_BASE_URL: z
      .string()
      .url()
      .default('http://localhost:8080')
      .transform((url) => url.replace(/\/+$/, '')),
    TRUST_PROXY: flag(false),
    DATA_DIR: z.string().min(1).default('./data'),

    DIRECTOR: z.enum(['fake', 'bedrock']).default('fake'),
    BEDROCK_MODEL: z.string().min(1).default('anthropic.claude-opus-5-5'),
    BEDROCK_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    BEDROCK_API_KEY: z.string().optional(),
    AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),

    VIDEO: z.enum(['fake', 'fal']).default('fake'),
    FAL_KEY: z.string().optional(),
    FAL_MODEL_T2V: z.string().min(1).default('minimax/h3-max-turbo/text-to-video'),
    FAL_MODEL_I2V: z.string().min(1).default('minimax/h3-max-turbo/image-to-video'),
    VIDEO_RESOLUTION: z.enum(['480P', '768P', '1080P']).default('768P'),
    SCENE_SECONDS: int(8, 1, 30),
    PROMPT_EXPANSION: z.enum(['disabled', 'balanced', 'quality']).default('disabled'),
    VIDEO_PRICE_PER_SECOND: z.coerce.number().nonnegative().default(0.04),
    FAKE_VIDEO_DELAY_MS: int(2500, 0, 120_000),
    FAKE_VIDEO_SIZE: z
      .string()
      .regex(/^\d{2,4}x\d{2,4}$/, 'must look like 1344x768')
      .default('1344x768'),
    FONT_FILE: z.string().default('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),

    SAFETY: z.enum(['wordlist', 'guardrails']).default('wordlist'),
    GUARDRAIL_ID: z.string().optional(),
    GUARDRAIL_VERSION: z.string().min(1).default('DRAFT'),

    ADMIN_TOKEN: z.string().optional(),
    DAILY_IDEAS: int(6, 0, 24),
    SCENES_PER_STORY: int(6, 2, 12),
    MAX_PARALLEL_JOBS: int(6, 1, 64),
    WARM_DEPTH: int(1, 0, 4),
    // A hard safety cap on private scenes per TV per day, paid or free.
    DEVICE_DAILY_CUSTOM_LIMIT: int(60, 0, 10_000),
    IDEA_LIFETIME_DAYS: int(1, 1, 60),
    SCENE_COST_SPARKS: int(1, 0, 1_000),
    WELCOME_FREE_SPARKS: int(1, 0, 1_000),
    DAILY_FREE_SPARKS: int(0, 0, 1_000),
    // The welcome scene only unlocks after a TV has watched this many scenes.
    FREE_SPARK_UNLOCK_AFTER_SCENES: int(0, 0, 10_000),
    SPARK_PRODUCTS: z
      .string()
      .regex(/^[A-Za-z0-9._]+:[1-9]\d*(,[A-Za-z0-9._]+:[1-9]\d*)*$/, 'must look like sku:sparks,sku:sparks')
      .default('storyquest.sparks.10:10,storyquest.sparks.25:25'),
    IAP_MODE: z.enum(['fake', 'sandbox', 'production']).default('fake'),
    AMAZON_IAP_SHARED_SECRET: z.string().optional(),
    DAILY_VIDEO_SECONDS_CAP: int(900, 0, 100_000_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.VIDEO === 'fal' && !env.FAL_KEY) {
      ctx.addIssue({ code: 'custom', path: ['FAL_KEY'], message: 'is required when VIDEO=fal' });
    }
    if (env.SAFETY === 'guardrails' && !env.GUARDRAIL_ID) {
      ctx.addIssue({ code: 'custom', path: ['GUARDRAIL_ID'], message: 'is required when SAFETY=guardrails' });
    }
    if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length < 16) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_TOKEN'], message: 'must be at least 16 characters' });
    }
  })
  .transform((env) => {
    const [width, height] = env.FAKE_VIDEO_SIZE.split('x').map(Number) as [number, number];
    return {
      ...env,
      sparkProducts: env.SPARK_PRODUCTS.split(',').map((entry) => {
        const [sku, sparks] = entry.split(':') as [string, string];
        return { sku, sparks: Number(sparks) };
      }),
      purchasesEnabled: env.IAP_MODE === 'fake' || Boolean(env.AMAZON_IAP_SHARED_SECRET),
      bedrockToken: env.BEDROCK_API_KEY ?? env.AWS_BEARER_TOKEN_BEDROCK,
      fakeVideoWidth: width - (width % 2),
      fakeVideoHeight: height - (height % 2),
    };
  });

export type Config = z.output<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Empty values in .env files mean "not set", so the defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return result.data;
}
