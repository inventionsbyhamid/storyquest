import type { ChoiceStat, ShareView } from '@storyquest/contracts';

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

const STYLES = `
:root{color-scheme:dark;--bg:#07070c;--panel:#12121c;--line:#24243a;--text:#f3efe6;--muted:#a9a3b8;--gold:#f5c26b;--rose:#ff8fa3}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#2a1f4d 0%,transparent 60%),radial-gradient(900px 500px at 100% 0%,#4a2a1a 0%,transparent 55%),var(--bg);min-height:100vh}
main{max-width:880px;margin:0 auto;padding:28px 16px 48px}
.brand{letter-spacing:.24em;text-transform:uppercase;font-size:12px;color:var(--gold);font-weight:600}
h1{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-weight:600;font-size:clamp(32px,7vw,56px);line-height:1.05;margin:10px 0 6px}
.sub{color:var(--muted);margin:0 0 22px}
.screen{position:relative;border-radius:18px;overflow:hidden;background:#000;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px var(--line)}
video{display:block;width:100%;aspect-ratio:16/9;background:#000}
.note{color:var(--muted);font-size:14px;margin:10px 2px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0 8px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.stat b{display:block;font-size:26px;color:var(--gold);font-family:Georgia,serif}
.stat span{color:var(--muted);font-size:14px}
.rare{background:linear-gradient(135deg,#3a2347,#1d1830);border-color:#5b3a6e}
.rare b{font-size:18px;color:var(--rose)}
h2{font-family:Georgia,serif;font-weight:600;font-size:24px;margin:34px 0 14px}
ol{list-style:none;margin:0;padding:0}
li.scene{display:grid;grid-template-columns:150px 1fr;gap:14px;align-items:center;padding:12px;border-radius:14px;cursor:pointer;border:1px solid transparent}
li.scene:hover,li.scene.playing{background:var(--panel);border-color:var(--line)}
li.scene img{width:150px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#1a1a26}
.num{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cap{margin:2px 0 0}
li.choice{margin:2px 0 2px 76px;padding:6px 0 6px 18px;border-left:2px dashed var(--line);color:var(--muted);font-size:14px}
li.choice strong{color:var(--text);font-weight:600}
li.choice em{display:block;font-style:normal;color:var(--gold)}
footer{margin-top:44px;text-align:center;color:var(--muted);font-size:14px}
footer strong{color:var(--text)}
@media (max-width:560px){li.scene{grid-template-columns:110px 1fr}li.scene img{width:110px}li.choice{margin-left:54px}}
`;

export function renderSharePage(view: ShareView, shareUrl: string): string {
  const title = escapeHtml(view.title);
  const first = view.scenes[0];
  const playlist = view.movieStatus !== 'ready';
  const source = view.movieUrl ?? first?.clipUrl ?? '';
  // A rarest choice is only worth a headline once it is actually rare.
  const rare = view.stats.rarestChoice && view.stats.rarestChoice.percent < 50 ? view.stats.rarestChoice : null;
  const description = rare
    ? `A family chose their own path through ${view.title}. ${choicePhrase(rare)}: ${rare.label}.`
    : `A family chose their own path through ${view.title}.`;

  const steps = view.scenes
    .map((scene, i) => {
      const stat = view.stats.choices[i - 1];
      const choice =
        i > 0 && scene.choiceTaken
          ? `<li class="choice">They chose <strong>${escapeHtml(scene.choiceTaken)}</strong>${stat ? `<em>${escapeHtml(choicePhrase(stat))}</em>` : ''}</li>`
          : '';
      const poster = scene.posterUrl ? `<img src="${escapeHtml(scene.posterUrl)}" alt="" loading="lazy">` : '<img alt="">';
      return `${choice}<li class="scene" data-index="${i}">${poster}<div><div class="num">Scene ${i + 1}</div><p class="cap">${escapeHtml(scene.caption ?? '')}</p></div></li>`;
    })
    .join('');

  const rareCard = rare
    ? `<div class="stat rare"><span>Rarest choice</span><b>${escapeHtml(rare.label)}</b><span>${escapeHtml(choicePhrase(rare))}</span></div>`
    : '';
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
<style>${STYLES}</style>
</head>
<body>
<main>
<div class="brand">StoryQuest</div>
<h1>${title}</h1>
<p class="sub">${escapeHtml(`A story one family steered with their TV remote${formatDate(view.createdAt) ? `, ${formatDate(view.createdAt)}` : ''}.`)}</p>
<div class="screen"><video id="player" controls playsinline preload="metadata" src="${escapeHtml(source)}"${first?.posterUrl ? ` poster="${escapeHtml(first.posterUrl)}"` : ''}></video></div>
${playlist ? '<p class="note">The full movie is still being put together, so here are the scenes in order.</p>' : ''}
<div class="stats">
<div class="stat"><b>${families}</b><span>${families === 1 ? 'family played this story' : 'families played this story'}</span></div>
<div class="stat"><b>${endings}</b><span>${endings === 1 ? 'ending discovered so far' : 'endings discovered so far'}</span></div>
${rareCard}
</div>
<h2>Their path</h2>
<ol>${steps}</ol>
<footer>Made with <strong>StoryQuest</strong> on Fire TV</footer>
</main>
<script type="application/json" id="scenes">${jsonForScript(view.scenes)}</script>
<script>
(function(){
  var scenes = JSON.parse(document.getElementById('scenes').textContent);
  var player = document.getElementById('player');
  var playlist = ${playlist ? 'true' : 'false'};
  var items = document.querySelectorAll('li.scene');
  var current = 0;
  function mark(i){ items.forEach(function(el){ el.classList.toggle('playing', Number(el.dataset.index) === i); }); }
  function play(i){
    if (!scenes[i]) return;
    current = i;
    if (playlist) { player.src = scenes[i].clipUrl; if (scenes[i].posterUrl) player.poster = scenes[i].posterUrl; }
    player.play().catch(function(){});
    mark(i);
  }
  if (playlist) {
    player.addEventListener('ended', function(){ if (current < scenes.length - 1) play(current + 1); });
    mark(0);
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
<body><main><div class="brand">StoryQuest</div><h1>We could not find that story</h1>
<p class="sub">The link may be mistyped. Scan the code on your TV again to get a fresh one.</p>
<footer>Made with <strong>StoryQuest</strong> on Fire TV</footer></main></body></html>`;
}
