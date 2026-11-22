// Builds the static site into dist/: the launch page, the experiments (Markdown → HTML), an RSS feed and a sitemap.
//   node build.mjs            → dist/   (DRAFTS=1 includes drafts)
//   SITE_URL=https://example.tech node build.mjs
// Source of truth: index.html (the page, also previewable as-is), experiments/*.md, assets/.
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'dist');
const SITE = (process.env.SITE_URL || 'https://rethinkphone.tech').replace(/\/$/, '');
const NAME = 'Rethink Phone';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(HERE, 'assets'), path.join(OUT, 'assets'), { recursive: true });

// ---------- the launch page ----------
let page = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const title = page.match(/<title>(.*?)<\/title>/)[1];
const description = page.match(/<meta name="description" content="(.*?)">/)[1];
const css = page.match(/<style>([\s\S]*?)<\/style>/)[1];
const header = page.match(/<header class="nav">[\s\S]*?<\/header>/)[0];
const fontLinks = [...page.matchAll(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g)].map((m) => m[0]).join('\n');
const svgDefs = page.match(/<svg width="0" height="0"[\s\S]*?<\/svg>/)[0];

// shared stylesheet for experiment pages, so the header and type are exactly the page's
write('assets/site.css', css);

const expLink = '<a href="/experiments/">Experiments</a>';
page = page.replace('<a href="#plan">Roadmap</a>', `<a href="#plan">Roadmap</a>\n      ${expLink}`);

const head = ({ title, description, url, image = `${SITE}/assets/og.jpg`, type = 'website', extra = '' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${NAME} experiments" href="${SITE}/experiments/feed.xml">
<meta property="og:site_name" content="${NAME}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ffffff">
<style>
:root { color-scheme: light; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
${extra}`;

const body = page
  .replace(/<title>.*?<\/title>\n?/, '')
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, '')
  .replace(/<meta name="description"[^>]*>\n?/, '');
write('index.html', head({ title, description, url: `${SITE}/` }) + body + '\n</html>\n');

// ---------- experiments ----------
// Each experiment is a product feature tried on the real phone: experiments/NN-slug.md, numbered by filename.
const expDir = path.join(HERE, 'experiments');
const STATUSES = ['Working', 'In progress', 'Didn’t work'];
const exps = (fs.existsSync(expDir) ? fs.readdirSync(expDir) : [])
  .filter((f) => /^\d+-.+\.md$/.test(f))
  .map((f) => {
    const raw = fs.readFileSync(path.join(expDir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`${f}: missing front matter`);
    const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')];
    }));
    for (const k of ['title', 'date', 'status', 'summary']) if (!meta[k]) throw new Error(`${f}: front matter needs ${k}`);
    if (!STATUSES.includes(meta.status)) throw new Error(`${f}: status must be one of ${STATUSES.join(', ')}`);
    const [, num, slug] = f.match(/^(\d+)-(.+)\.md$/);
    return { ...meta, num: num.padStart(2, '0'), slug, draft: meta.draft === 'true', html: marked.parse(m[2]) };
  })
  .filter((p) => !p.draft || process.env.DRAFTS === '1')
  .sort((a, b) => b.num.localeCompare(a.num));

const subHead = (o) => head({ ...o, extra: `${fontLinks}\n<link rel="stylesheet" href="/assets/site.css">\n<link rel="stylesheet" href="/assets/experiments.css">` });
const siteHeader = header
  .replace('href="#top"', 'href="/"')
  .replace(/href="#(\w+)"/g, 'href="/#$1"')
  .replace('<a href="/#plan">Roadmap</a>', `<a href="/#plan">Roadmap</a>\n      ${expLink}`);
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const statusTag = (s) => `<span class="status" data-s="${s === 'Working' ? 'ok' : s === 'In progress' ? 'wip' : 'no'}">${esc(s)}</span>`;
const footer = `<footer class="bfoot"><div class="wrap"><span>${NAME}. Open source, MIT.</span><a href="https://github.com/gauravtiwari5050/rethink">Source</a><a href="/experiments/feed.xml">RSS</a></div></footer>`;
const EXP_DESC = 'Features we are building into Rethink Phone, tried on a real handset. Each one says whether it works, and how to reproduce it.';

for (const p of exps) {
  const url = `${SITE}/experiments/${p.slug}/`;
  write(`experiments/${p.slug}/index.html`, subHead({ title: `Experiment ${p.num}: ${p.title} · ${NAME}`, description: p.summary, url, type: 'article' }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="post wrap">
  <p class="meta"><a href="/experiments/">Experiments</a> · No. ${p.num} · <time datetime="${p.date}">${fmtDate(p.date)}</time></p>
  <h1>${esc(p.title)}</h1>
  <p class="standfirst">${esc(p.summary)}</p>
  <p class="tags">${statusTag(p.status)}</p>
  <article class="prose">
${p.html}
  </article>
</main>
${footer}
</body>
</html>
`);
}

write('experiments/index.html', subHead({ title: `Experiments · ${NAME}`, description: EXP_DESC, url: `${SITE}/experiments/` }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="expindex wrap">
  <h1>Experiments</h1>
  <p class="standfirst">${EXP_DESC}</p>
  <ol class="list">
${exps.length ? exps.map((p) => `    <li><a href="/experiments/${p.slug}/"><span class="no">No. ${p.num}</span><b>${esc(p.title)}</b><span class="sum">${esc(p.summary)}</span><span class="side">${statusTag(p.status)}<time datetime="${p.date}">${fmtDate(p.date)}</time></span></a></li>`).join('\n') : '    <li class="empty">The first experiment is on its way.</li>'}
  </ol>
</main>
${footer}
</body>
</html>
`);

write('experiments/feed.xml', `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${NAME} experiments</title>
<link>${SITE}/experiments/</link>
<atom:link href="${SITE}/experiments/feed.xml" rel="self" type="application/rss+xml"/>
<description>${EXP_DESC}</description>
<language>en</language>
${exps.map((p) => `<item><title>Experiment ${p.num}: ${esc(p.title)} (${esc(p.status)})</title><link>${SITE}/experiments/${p.slug}/</link><guid>${SITE}/experiments/${p.slug}/</guid><pubDate>${new Date(p.date + 'T09:00:00Z').toUTCString()}</pubDate><description>${esc(p.summary)}</description></item>`).join('\n')}
</channel>
</rss>
`);

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[`${SITE}/`, `${SITE}/experiments/`, ...exps.map((p) => `${SITE}/experiments/${p.slug}/`)].map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('404.html', subHead({ title: `Not found · ${NAME}`, description: 'Page not found.', url: `${SITE}/404` }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="expindex wrap"><h1>Not found.</h1><p class="standfirst">That page doesn’t exist. <a href="/">Go to the home page</a>.</p></main>
</body>
</html>
`);
// long cache for renders and fonts-free assets; HTML always fresh (Cloudflare Pages / Netlify format)
write('_headers', `/assets/*\n  Cache-Control: public, max-age=86400\n/*.html\n  Cache-Control: public, max-age=0, must-revalidate\n/*.jsonl\n  Content-Type: text/plain; charset=utf-8\n/*.log\n  Content-Type: text/plain; charset=utf-8\n`);

console.log(`built ${exps.length} experiment(s) → ${path.relative(process.cwd(), OUT) || OUT} for ${SITE}`);
