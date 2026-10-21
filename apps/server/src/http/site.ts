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

export interface Showcase {
  stories: Array<{ title: string; logline: string; posterUrl: string; tone: string | null }>;
  featured: { title: string; scenes: Array<{ posterUrl: string; caption: string; choiceTaken: string | null }> } | null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const AWS = 'Amazon Web Services';
// OpenRouter host slugs, region suffix removed, with the company that runs them.
const HOSTS: Record<string, [company: string, writer: string]> = {
  'amazon-bedrock': [AWS, 'Amazon Bedrock writes the scene'],
  anthropic: ['Anthropic', 'writes the scene'],
  'google-vertex': ['Google Cloud', 'Vertex AI writes the scene'],
  azure: ['Microsoft Azure', 'writes the scene'],
  openai: ['OpenAI', 'writes the scene'],
};

/** Names every outside service that sees a family's story, from what this server is set up to use. */
export function providersSentence(config: Config): string {
  const roles = new Map<string, string[]>();
  const add = (company: string, role: string) => roles.set(company, [...(roles.get(company) ?? []), role]);

  switch (config.DIRECTOR) {
    case 'bedrock':
      add(AWS, 'Amazon Bedrock writes the scene');
      break;
    case 'anthropic':
      add('Anthropic', 'writes the scene');
      break;
    case 'openrouter': {
      const hosts = config.openRouterProviders.map((slug) => HOSTS[slug.split('/')[0]!]);
      if (hosts.length && hosts.every(Boolean)) {
        add('OpenRouter', 'passes it on');
        for (const [company, role] of hosts as Array<[string, string]>) add(company, role);
      } else {
        add('OpenRouter', 'passes it to the AI model that writes the scene');
      }
      break;
    }
    case 'openai': {
      const host = new URL(config.OPENAI_BASE_URL).hostname;
      add(host === 'api.openai.com' ? 'OpenAI' : host, 'writes the scene');
      break;
    }
  }
  if (config.SAFETY === 'guardrails') add(AWS, 'Amazon Bedrock Guardrails checks it for safety');
  if (config.VIDEO === 'fal') add('fal', 'films the video');

  if (roles.size === 0) return 'Scenes are written and filmed on our own server.';
  const list = [...roles].map(([company, parts]) => `${company} (${[...new Set(parts)].join(' and ')})`);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `To write and film a scene we send the story so far and your idea to our service providers: ${escapeHtml(joined!)}. They process this text and images only to make your scene.`;
}

function youtubeId(url: string | undefined): string | null {
  return url?.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}

const toneStyle = (tone: string | null) => (tone && /^#[0-9A-Fa-f]{6}$/.test(tone) ? ` style="--tone:${tone}"` : '');

/** The home page parts that come from the filmed stories, rendered on each visit. */
function renderShowcase(config: Config, showcase: Showcase): Record<string, string> {
  const video = youtubeId(config.DEMO_VIDEO_URL);
  const first = showcase.stories[0];
  const top = video
    ? `<div class="film"><iframe src="https://www.youtube-nocookie.com/embed/${video}" title="StoryQuest demo film" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`
    : first
      ? `<figure class="hero"${toneStyle(first.tone)}><img src="${escapeHtml(first.posterUrl)}" alt="The opening scene of ${escapeHtml(first.title)}"></figure>`
      : '';

  const stories = showcase.stories.length
    ? `<h2>Tonight's stories</h2>
<ul class="stories">${showcase.stories
        .map(
          (story) =>
            `<li${toneStyle(story.tone)}><img src="${escapeHtml(story.posterUrl)}" alt="" loading="lazy"><b>${escapeHtml(story.title)}</b><span>${escapeHtml(story.logline)}</span></li>`,
        )
        .join('')}</ul>`
    : '';

  const featured = showcase.featured;
  const scenes =
    featured && featured.scenes.length > 1
      ? `<h2>One story, scene by scene</h2>
<p>${escapeHtml(featured.title)}, as one family steered it. Every picture is a frame from a filmed scene.</p>
<ol class="scenes">${featured.scenes
          .map(
            (scene) =>
              `<li><img src="${escapeHtml(scene.posterUrl)}" alt="" loading="lazy">${scene.choiceTaken ? `<span class="took">They chose ${escapeHtml(scene.choiceTaken)}</span>` : '<span class="took">The opening</span>'}<span>${escapeHtml(scene.caption)}</span></li>`,
          )
          .join('')}</ol>`
      : '';

  return { top, stories, scenes };
}

export async function registerSite(
  app: FastifyInstance,
  config: Config,
  showcase: () => Showcase = () => ({ stories: [], featured: null }),
): Promise<void> {
  const dir = path.resolve(config.SITE_DIR);
  const layout = readFileSync(path.join(dir, 'layout.html'), 'utf8');
  const email = escapeHtml(config.SUPPORT_EMAIL);
  const values: Record<string, string> = {
    company: escapeHtml(config.COMPANY_NAME),
    contact: email ? `<a href="mailto:${email}">${email}</a>` : 'us through the StoryQuest page on the Amazon Appstore',
    updated: escapeHtml(config.POLICY_UPDATED),
    providers: providersSentence(config),
    year: String(new Date().getUTCFullYear()),
  };
  const fill = (template: string, extra: Record<string, string>) =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => extra[key] ?? values[key] ?? '');

  for (const [route, page] of Object.entries(PAGES)) {
    const template = readFileSync(path.join(dir, page.file), 'utf8');
    const render = () => {
      const content = fill(template, route === '/' ? renderShowcase(config, showcase()) : {});
      return fill(layout, { content, title: escapeHtml(page.title), description: escapeHtml(page.description) });
    };
    const fixed = route === '/' ? null : render();
    app.get(route, async (_request, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .header('cache-control', `public, max-age=${fixed ? 300 : 60}`)
        .send(fixed ?? render()),
    );
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
