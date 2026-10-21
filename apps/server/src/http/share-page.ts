import type { ChoiceStat, ShareView } from '@storyquest/contracts';
import { mixHex } from '../tone';

// Every visible string on this page follows the house style: no dashes or hyphens.

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jsonForScript = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function choicePhrase(stat: ChoiceStat): string {
  if (stat.custom) return 'An idea all their own';
  if (stat.percent >= 100) return 'Every family so far chose this';
  if (stat.percent <= 30) return `Only ${stat.percent}% of families chose this`;
  if (stat.percent >= 70) return `${stat.percent}% of families chose this too`;
  return `${stat.percent}% of families chose this`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const MARK = '<svg viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="#F0A830" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="50" r="34" stroke-width="12"/><path d="M58 62 C66 70 72 76 80 82" stroke-width="12"/><path d="M80 82 C88 86 96 86 106 80" stroke-width="8"/><path d="M80 82 C84 90 84 98 80 108" stroke-width="8"/></g><circle cx="107" cy="79" r="7" fill="#F0A830"/><circle cx="79.5" cy="109" r="7" fill="#F0A830"/></svg>';

const STYLES = `
@font-face{font-family:"Fraunces";src:url("/static/fraunces.ttf") format("truetype");font-display:swap}
:root{color-scheme:dark;--ink:#1C2240;--raised:#262D52;--line:#3A4270;--paper:#F1E6CF;--dim:#B6AE9C;--marigold:#F0A830}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ink);color:var(--paper)}
body{font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 20px 56px}
a{color:var(--paper);text-decoration-color:var(--marigold);text-underline-offset:3px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.brand svg{width:30px;height:30px}
.brand span{font-family:"Fraunces",Georgia,serif;font-size:22px}
h1,h2{font-family:"Fraunces",Georgia,serif;font-weight:normal;line-height:1.15}
h1{font-size:clamp(34px,7vw,56px);margin:28px 0 8px;letter-spacing:-.5px}
h2{font-size:26px;margin:44px 0 16px}
.sub{color:var(--dim);margin:0 0 24px}
.plate{background:var(--paper);padding:10px;border-radius:18px}
video{display:block;width:100%;aspect-ratio:16/9;background:var(--raised);border-radius:10px}
.note{color:var(--dim);font-size:15px;margin:12px 2px 0}
.facts{margin:24px 0 0;padding:0;list-style:none;color:var(--dim)}
.facts li{margin:4px 0}
ol{list-style:none;margin:0;padding:0}
li.scene{display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:center;padding:10px;border-radius:14px;cursor:pointer;border:2px solid transparent}
li.scene:hover,li.scene.playing{background:var(--raised)}
li.scene:focus-visible{outline:3px solid var(--marigold);outline-offset:2px}
li.scene img{width:160px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:var(--raised)}
li.scene.removed{cursor:default}
li.scene.removed:hover{background:none}
div.gone{width:160px;aspect-ratio:16/9;border-radius:10px;border:2px dashed var(--line);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:14px}
p.gone{color:var(--dim);font-size:15px}
.num{font-size:15px;color:var(--dim)}
.cap{margin:2px 0 0}
li.choice{margin:2px 0 2px 84px;padding:6px 0 6px 18px;border-left:2px solid var(--line);color:var(--dim);font-size:15px}
li.choice strong{color:var(--paper);font-weight:600}
li.choice span{display:block}
footer{margin-top:52px;padding-top:24px;border-top:1px solid var(--line);color:var(--dim);font-size:15px}
footer a{color:var(--dim)}
@media (max-width:560px){li.scene{grid-template-columns:116px 1fr}li.scene img,div.gone{width:116px}li.choice{margin-left:60px}}
`;

export function renderSharePage(view: ShareView, shareUrl: string, contact = '', reportLink = ''): string {
  const title = escapeHtml(view.title);
  const first = view.scenes.find((scene) => !scene.removed);
  const playlist = view.movieStatus !== 'ready';
  const removedAny = view.scenes.some((scene) => scene.removed);
  const source = view.movieUrl ?? first?.clipUrl ?? '';
  // The page takes the night color of the opening scene, like the TV does.
  const night = first?.tone && /^#[0-9A-Fa-f]{6}$/.test(first.tone) ? first.tone : null;
  const toneStyle = night
    ? `<style>:root{--ink:${night};--raised:${mixHex(night, '#F1E6CF', 0.07)};--line:${mixHex(night, '#F1E6CF', 0.16)}}</style>`
    : '';
  // A rarest choice is only worth a headline once it is actually rare.
  const rare = view.stats.rarestChoice && view.stats.rarestChoice.percent < 50 ? view.stats.rarestChoice : null;
  const description = rare
    ? `A family chose their own path through ${view.title}. ${choicePhrase(rare)}: ${rare.label}.`
    : `A family chose their own path through ${view.title}.`;

  // Only the first clip of each chapter follows a choice, so stats are matched in order of choices.
  let choiceIndex = 0;
  const steps = view.scenes
    .map((scene, i) => {
      const stat = i > 0 && scene.choiceTaken ? view.stats.choices[choiceIndex++] : undefined;
      const choice =
        i > 0 && scene.choiceTaken
          ? `<li class="choice">They chose <strong>${escapeHtml(scene.choiceTaken)}</strong>${stat ? `<span>${escapeHtml(choicePhrase(stat))}</span>` : ''}</li>`
          : '';
      const number = `<div class="num">Scene ${i + 1} of ${view.scenes.length}</div>`;
      if (scene.removed) {
        return `${choice}<li class="scene removed"><div class="gone">Removed</div><div>${number}<p class="cap">${escapeHtml(scene.caption ?? '')}</p><p class="cap gone">This scene was removed.</p></div></li>`;
      }
      const poster = scene.posterUrl ? `<img src="${escapeHtml(scene.posterUrl)}" alt="" loading="lazy">` : '<img alt="">';
      return `${choice}<li class="scene" tabindex="0" data-index="${i}">${poster}<div>${number}<p class="cap">${escapeHtml(scene.caption ?? '')}</p></div></li>`;
    })
    .join('');

  const families = view.stats.familiesPlayed;
  const endings = view.stats.endingsDiscovered;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | StoryQuest</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="StoryQuest">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(shareUrl)}">
${first?.posterUrl ? `<meta property="og:image" content="${escapeHtml(first.posterUrl)}">` : ''}
${view.movieUrl ? `<meta property="og:video" content="${escapeHtml(view.movieUrl)}"><meta property="og:video:type" content="video/mp4">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>${STYLES}</style>${toneStyle}
</head>
<body>
<main>
<a class="brand" href="/">${MARK}<span>StoryQuest</span></a>
<h1>${title}</h1>
<p class="sub">${escapeHtml(`A story one family steered with their TV remote${formatDate(view.createdAt) ? `, ${formatDate(view.createdAt)}` : ''}.`)}</p>
<div class="plate"><video id="player" controls playsinline preload="metadata" src="${escapeHtml(source)}"${first?.posterUrl ? ` poster="${escapeHtml(first.posterUrl)}"` : ''}></video></div>
${playlist ? `<p class="note">${removedAny ? 'Some scenes of this story were removed, so here are the others in order.' : 'The full movie is still being put together, so here are the scenes in order.'}</p>` : ''}
<ul class="facts">
<li>${families === 1 ? '1 family has played this story.' : `${families} families have played this story.`}</li>
<li>${endings === 1 ? '1 ending has been discovered so far.' : `${endings} endings have been discovered so far.`}</li>
${rare ? `<li>${escapeHtml(choicePhrase(rare))}: ${escapeHtml(rare.label)}.</li>` : ''}
</ul>
<h2>Their path</h2>
<ol>${steps}</ol>
<footer>Made with StoryQuest on Fire TV. ${contact ? `To report this story, contact ${contact}.` : ''} ${reportLink} <a href="/privacy">Privacy</a></footer>
</main>
<script type="application/json" id="scenes">${jsonForScript(view.scenes)}</script>
<script>
(function(){
  var scenes = JSON.parse(document.getElementById('scenes').textContent);
  var player = document.getElementById('player');
  var playlist = ${playlist ? 'true' : 'false'};
  var items = document.querySelectorAll('li.scene[data-index]');
  var current = 0;
  function mark(i){ items.forEach(function(el){ el.classList.toggle('playing', Number(el.dataset.index) === i); }); }
  function next(i){ while (i < scenes.length && scenes[i].removed) i++; return i; }
  function play(i){
    if (!scenes[i] || scenes[i].removed) return;
    current = i;
    if (playlist) { player.src = scenes[i].clipUrl; if (scenes[i].posterUrl) player.poster = scenes[i].posterUrl; }
    player.play().catch(function(){});
    mark(i);
  }
  if (playlist) {
    player.addEventListener('ended', function(){ play(next(current + 1)); });
    current = next(0);
    mark(current);
  }
  items.forEach(function(el){
    el.addEventListener('click', function(){
      play(Number(el.dataset.index));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
</script>
</body>
</html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Story not found | StoryQuest</title><style>${STYLES}</style></head>
<body><main><a class="brand" href="/">${MARK}<span>StoryQuest</span></a><h1>We could not find that story</h1>
<p class="sub">The link may be mistyped. Scan the code on your TV again to get a fresh one.</p>
<footer>Made with StoryQuest on Fire TV.</footer></main></body></html>`;
}
