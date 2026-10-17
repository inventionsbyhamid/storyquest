#!/usr/bin/env node
// Plays one story end to end against a running server and prints what happened.
// Against a server configured with real providers this spends real money.
//
//   node scripts/smoke.mjs                      uses http://localhost:8080
//   BASE_URL=https://example.com node scripts/smoke.mjs --custom "the dog learns to fly"

const base = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const customIndex = process.argv.indexOf('--custom');
const customText = customIndex > -1 ? process.argv[customIndex + 1] : null;
const headers = { 'content-type': 'application/json', 'x-device-id': `smoke_${Date.now()}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function waitForScene(id) {
  const started = Date.now();
  for (let i = 0; i < 40; i++) {
    const scene = await call('GET', `/v1/nodes/${id}?wait=15`);
    if (scene.status === 'ready') return { scene, waitedMs: Date.now() - started };
    if (scene.status === 'failed') throw new Error(`scene ${id} failed: ${scene.error}`);
  }
  throw new Error(`scene ${id} was not ready after ten minutes`);
}

let today;
for (let i = 0; i < 60; i++) {
  today = await call('GET', '/v1/today');
  if (today.ideas.length > 0) break;
  await sleep(2000);
}
if (!today?.ideas.length) throw new Error('no ideas for today');
console.log(`Today (${today.date}): ${today.ideas.map((idea) => `${idea.title} [${idea.audience}]`).join(', ')}`);

const idea = today.ideas[0];
let story = await call('POST', '/v1/stories', { kind: 'idea', ideaId: idea.id });
console.log(`Started "${story.title}" as ${story.id}`);

for (let step = 0; step < 20; step++) {
  const { scene, waitedMs } = await waitForScene(story.currentNodeId);
  console.log(
    `Scene ${scene.sceneNumber}/${scene.totalScenes}: ${scene.caption} (waited ${waitedMs} ms, made in ${scene.generationMs ?? '?'} ms)`,
  );
  if (scene.isEnding) break;
  const useCustom = customText && step === 1;
  const choice = useCustom
    ? { kind: 'custom', fromNodeId: scene.id, text: customText }
    : { kind: 'preset', fromNodeId: scene.id, index: step % 2 };
  const label = useCustom ? `custom: ${customText}` : scene.choices[choice.index].label;
  const ready = useCustom ? '' : scene.choices[choice.index].ready ? ' (already made)' : ' (not made yet)';
  console.log(`  choosing ${label}${ready}`);
  story = (await call('POST', `/v1/stories/${story.id}/choose`, choice)).story;
}

const finish = await call('POST', `/v1/stories/${story.id}/finish`, {});
console.log(`Finished. Share link: ${finish.shareUrl}`);
for (const choice of finish.stats.choices) {
  console.log(`  after scene ${choice.sceneNumber}: ${choice.label} (${choice.custom ? 'custom' : `${choice.percent}%`})`);
}

for (let i = 0; i < 60; i++) {
  const share = await call('GET', `/v1/share/${finish.shareSlug}`);
  if (share.movieStatus !== 'pending') {
    console.log(`Movie ${share.movieStatus}: ${share.movieUrl ?? 'none'}`);
    break;
  }
  await sleep(1000);
}
