import { readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';

const PAGES = {
  '/': { file: 'index.html', title: 'StoryQuest', description: 'Family stories you steer with your Fire TV remote. Every scene is a short film made by AI.' },
  '/privacy': { file: 'privacy.html', title: 'Privacy policy | StoryQuest', description: 'What StoryQuest collects and why.' },
  '/terms': { file: 'terms.html', title: 'Terms of use | StoryQuest', description: 'The terms for using StoryQuest.' },
  '/support': { file: 'support.html', title: 'Support | StoryQuest', description: 'Help with StoryQuest.' },
} as const;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function registerSite(app: FastifyInstance, config: Config): Promise<void> {
  const dir = path.resolve(config.SITE_DIR);
  const layout = readFileSync(path.join(dir, 'layout.html'), 'utf8');
  const email = escapeHtml(config.SUPPORT_EMAIL);
  const values: Record<string, string> = {
    company: escapeHtml(config.COMPANY_NAME),
    contact: email ? `<a href="mailto:${email}">${email}</a>` : 'us through the StoryQuest page on the Amazon Appstore',
    updated: escapeHtml(config.POLICY_UPDATED),
    year: String(new Date().getUTCFullYear()),
  };
  const fill = (template: string, extra: Record<string, string>) =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => extra[key] ?? values[key] ?? '');

  for (const [route, page] of Object.entries(PAGES)) {
    const content = fill(readFileSync(path.join(dir, page.file), 'utf8'), {});
    const html = fill(layout, { content, title: escapeHtml(page.title), description: escapeHtml(page.description) });
    app.get(route, async (_request, reply) => reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300').send(html));
  }

  await app.register(fastifyStatic, {
    root: path.join(dir, 'static'),
    prefix: '/static/',
    decorateReply: false,
    index: false,
    list: false,
    cacheControl: true,
    maxAge: '30d',
  });
}
