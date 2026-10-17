import { createHash, timingSafeEqual } from 'node:crypto';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  ChooseRequest,
  ChooseResponse,
  DEVICE_HEADER,
  type ErrorCode,
  type ErrorResponse,
  FinishResponse,
  SceneView,
  ShareView,
  StartStoryRequest,
  StoryView,
  TodayResponse,
} from '@storyquest/contracts';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { AppError, badRequest, MESSAGES, notFound, rateLimited } from '../engine/errors';
import { PATH_ID, SLUG } from '../ids';
import { createServices, type ServiceOverrides, type Services } from '../services';
import { renderNotFoundPage, renderSharePage } from './share-page';
import { Views } from './views';

/** Structural so it accepts schemas from the contracts package's own copy of zod. */
interface Parser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

function parse<T>(schema: Parser<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .slice(0, 5)
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
  throw badRequest(`${MESSAGES.badRequest} ${details}`);
}

const errorBody = (code: ErrorCode, message: string): ErrorResponse => ({ error: { code, message } });

const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const NODE_WAIT_MAX_SECONDS = 15;

function deviceHeader(request: FastifyRequest): string | null {
  const value = request.headers[DEVICE_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requireDevice(request: FastifyRequest): string {
  const device = deviceHeader(request);
  if (!device || !DEVICE_ID.test(device)) throw badRequest(MESSAGES.missingDevice);
  return device;
}

function optionalDevice(request: FastifyRequest): string | null {
  const device = deviceHeader(request);
  return device && DEVICE_ID.test(device) ? device : null;
}

function idParam(value: string): string {
  if (!PATH_ID.test(value)) throw notFound();
  return value;
}

function safeEqual(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createServer(config: Config, overrides: ServiceOverrides = {}) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    requestTimeout: 30_000,
  });
  const services = createServices(config, app.log, overrides);
  await registerRoutes(app, services);
  return { app, services };
}

export async function registerRoutes(app: FastifyInstance, services: Services): Promise<void> {
  const { config, repo, engine, daily } = services;
  const views = new Views(services);
  const rateKey = (request: FastifyRequest) => `${request.ip}|${deviceHeader(request) ?? ''}`;

  // Clients often send an empty body with a JSON content type on POSTs like finish.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(badRequest(`${MESSAGES.badRequest} The body is not valid JSON.`), undefined);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send(errorBody(error.code, error.message));
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send(errorBody('rate_limited', MESSAGES.rateLimited));
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send(errorBody(status === 404 ? 'not_found' : 'bad_request', status === 404 ? MESSAGES.notFound : MESSAGES.badRequest));
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send(errorBody('internal', MESSAGES.internal));
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send(errorBody('not_found', MESSAGES.notFound)));

  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: rateKey,
    allowList: (request) => request.url.startsWith('/media/') || request.url === '/healthz',
  });
  const customChoiceLimit = app.createRateLimit({ max: 10, timeWindow: '1 minute', keyGenerator: rateKey });

  await app.register(fastifyStatic, {
    root: services.store.root,
    prefix: '/media/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    acceptRanges: true,
    cacheControl: true,
    maxAge: '365d',
    immutable: true,
  });

  app.get('/healthz', async () => ({
    ok: true,
    director: services.director.name,
    video: services.video.name,
    safety: services.safety.name,
    queue: engine.queueSize,
  }));

  app.get('/v1/today', async () => {
    const today = daily.today();
    let date = today;
    let ideas = repo.listIdeas(today);
    if (ideas.length < config.DAILY_IDEAS) daily.kick();
    if (ideas.length === 0) {
      // Around midnight UTC, keep showing yesterday's stories until today's exist.
      const latest = repo.latestIdeaDate();
      if (latest) {
        date = latest;
        ideas = repo.listIdeas(latest);
      }
    }
    return parse(TodayResponse, { date, ideas: ideas.map((idea) => views.idea(idea)) });
  });

  app.post('/v1/stories', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: rateKey } } }, async (request) => {
    const device = requireDevice(request);
    const body = parse(StartStoryRequest, request.body);
    const story = await engine.startStory(device, body);
    return parse(StoryView, views.story(story));
  });

  app.get<{ Params: { id: string } }>('/v1/stories/:id', async (request) => {
    const story = engine.getStory(idParam(request.params.id));
    return parse(StoryView, views.story(story));
  });

  app.get<{ Params: { id: string }; Querystring: { wait?: string } }>('/v1/nodes/:id', async (request, reply) => {
    const id = idParam(request.params.id);
    const wait = Math.min(NODE_WAIT_MAX_SECONDS, Math.max(0, Number(request.query.wait ?? 0) || 0));
    let node = repo.getNode(id);
    if (!node) throw notFound();
    if (wait > 0 && (node.status === 'pending' || node.status === 'generating')) {
      const abort = new AbortController();
      const onClose = () => abort.abort();
      reply.raw.once('close', onClose);
      node = (await engine.waitForNode(id, wait * 1000, abort.signal)) ?? node;
      reply.raw.off('close', onClose);
    }
    return parse(SceneView, views.scene(node));
  });

  app.post<{ Params: { id: string } }>('/v1/stories/:id/choose', async (request) => {
    const storyId = idParam(request.params.id);
    const body = parse(ChooseRequest, request.body);
    if (body.kind === 'custom') {
      const limit = await customChoiceLimit(request);
      if (!limit.isAllowed && limit.isExceeded) throw rateLimited();
    }
    const result = await engine.choose(storyId, optionalDevice(request), body);
    return parse(ChooseResponse, { story: views.story(result.story), nextNodeId: result.nextNodeId });
  });

  app.post<{ Params: { id: string } }>('/v1/stories/:id/finish', async (request) => {
    const story = await engine.finish(idParam(request.params.id), optionalDevice(request));
    return parse(FinishResponse, views.finish(story));
  });

  app.get<{ Params: { slug: string } }>('/v1/share/:slug', async (request) => {
    const story = SLUG.test(request.params.slug) ? repo.getStoryBySlug(request.params.slug) : null;
    if (!story) throw notFound();
    return parse(ShareView, views.share(story));
  });

  app.get<{ Params: { slug: string } }>('/s/:slug', async (request, reply) => {
    const story = SLUG.test(request.params.slug) ? repo.getStoryBySlug(request.params.slug) : null;
    reply.type('text/html; charset=utf-8');
    if (!story) return reply.code(404).send(renderNotFoundPage());
    reply.header('cache-control', 'public, max-age=60');
    return renderSharePage(views.share(story), views.shareUrl(story.shareSlug!));
  });

  const requireAdmin = (request: FastifyRequest) => {
    if (!config.ADMIN_TOKEN) throw notFound();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!safeEqual(token, config.ADMIN_TOKEN)) throw new AppError('bad_request', 401, MESSAGES.unauthorized);
  };

  app.post('/v1/admin/daily', async (request) => {
    requireAdmin(request);
    const created = await daily.ensure();
    const date = daily.today();
    return { date, created, ideas: repo.listIdeas(date).map((idea) => views.idea(idea)) };
  });

  app.get('/v1/admin/stats', async (request) => {
    requireAdmin(request);
    const date = daily.today();
    const stats = repo.stats(date);
    return {
      date,
      ...stats,
      videoSecondsCap: config.DAILY_VIDEO_SECONDS_CAP,
      estimatedVideoCostUsd: Math.round(stats.videoSecondsToday * config.VIDEO_PRICE_PER_SECOND * 100) / 100,
      queue: engine.queueSize,
      providers: { director: services.director.name, video: services.video.name, safety: services.safety.name },
    };
  });
}
