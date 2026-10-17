import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/http/app';
import type { Services } from '../src/services';
import { hasDash } from '../src/text';
import { testConfig, visibleText } from './helpers';

let current: { app: FastifyInstance; services: Services; dir: string } | null = null;

afterEach(async () => {
  if (!current) return;
  await current.app.close();
  await current.services.engine.stop(15_000);
  current.services.db.close();
  rmSync(current.dir, { recursive: true, force: true });
  current = null;
});

async function start(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-site-'));
  const { app, services } = await createServer(testConfig(dir, { DAILY_IDEAS: '0', ...env }));
  current = { app, services, dir };
  return app;
}

describe('website', () => {
  it('serves the home, privacy, terms and support pages', async () => {
    const app = await start({ COMPANY_NAME: 'Reel Labs', SUPPORT_EMAIL: 'help@example.com' });
    for (const [url, heading] of [
      ['/', 'Stories your family steers'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of use'],
      ['/support', 'Support'],
    ] as const) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      const text = visibleText(res.body);
      expect(text).toContain(heading);
      expect(text).toContain('Reel Labs');
      expect(res.body).toContain('mailto:help@example.com');
      expect(res.body).not.toMatch(/\{\{\w+\}\}/);
      expect(res.body).not.toContain('gradient');
      expect(hasDash(text)).toBe(false);
    }
  });

  it('points to the Appstore page when no support email is set', async () => {
    const app = await start();
    const res = await app.inject({ method: 'GET', url: '/support' });
    expect(res.body).not.toContain('mailto:');
    expect(visibleText(res.body)).toContain('Amazon Appstore');
  });

  it('serves the title font and the mark', async () => {
    const app = await start();
    const font = await app.inject({ method: 'GET', url: '/static/fraunces.ttf' });
    expect(font.statusCode).toBe(200);
    const mark = await app.inject({ method: 'GET', url: '/static/mark.svg' });
    expect(mark.statusCode).toBe(200);
    expect(mark.body).toContain('<svg');
  });
});
