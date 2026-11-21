// Builds the static site into dist/: the launch page, the blog (Markdown → HTML), an RSS feed and a sitemap.
//   node build.mjs            → dist/
//   SITE_URL=https://example.tech node build.mjs
// Source of truth: index.html (the page, also previewable as-is), blog/posts/*.md, assets/.
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

// shared stylesheet for the blog, so the header and type are exactly the page's
write('assets/site.css', css);

const blogLink = '<a href="/blog/">Blog</a>';
page = page.replace('<a href="#plan">Roadmap</a>', `<a href="#plan">Roadmap</a>\n      ${blogLink}`);

const head = ({ title, description, url, image = `${SITE}/assets/og.jpg`, type = 'website', extra = '' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${NAME} blog" href="${SITE}/blog/feed.xml">
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

// ---------- the blog ----------
const postsDir = path.join(HERE, 'blog', 'posts');
const posts = (fs.existsSync(postsDir) ? fs.readdirSync(postsDir) : [])
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const raw = fs.readFileSync(path.join(postsDir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`${f}: missing front matter`);
    const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')];
    }));
    for (const k of ['title', 'date', 'summary']) if (!meta[k]) throw new Error(`${f}: front matter needs ${k}`);
    const slug = meta.slug || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    return { ...meta, slug, draft: meta.draft === 'true', html: marked.parse(m[2]) };
  })
  .filter((p) => !p.draft || process.env.DRAFTS === '1')
  .sort((a, b) => b.date.localeCompare(a.date));

const blogHead = (o) => head({ ...o, extra: `${fontLinks}\n<link rel="stylesheet" href="/assets/site.css">\n<link rel="stylesheet" href="/assets/blog.css">` });
const siteHeader = header
  .replace('href="#top"', 'href="/"')
  .replace(/href="#(\w+)"/g, 'href="/#$1"')
  .replace('<a href="/#plan">Roadmap</a>', `<a href="/#plan">Roadmap</a>\n      ${blogLink}`);
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const footer = `<footer class="bfoot"><div class="wrap"><span>${NAME}. Open source, MIT.</span><a href="https://github.com/gauravtiwari5050/rethink">Source</a><a href="/blog/feed.xml">RSS</a></div></footer>`;

for (const p of posts) {
  const url = `${SITE}/blog/${p.slug}/`;
  write(`blog/${p.slug}/index.html`, blogHead({ title: `${p.title} · ${NAME}`, description: p.summary, url, type: 'article' }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="post wrap">
  <p class="meta"><a href="/blog/">Blog</a> · <time datetime="${p.date}">${fmtDate(p.date)}</time>${p.author ? ` · ${esc(p.author)}` : ''}</p>
  <h1>${esc(p.title)}</h1>
  <p class="standfirst">${esc(p.summary)}</p>
  <article class="prose">
${p.html}
  </article>
</main>
${footer}
</body>
</html>
`);
}

write('blog/index.html', blogHead({ title: `Blog · ${NAME}`, description: 'Notes from building Rethink Phone in the open: what works, what doesn’t, and how to reproduce it.', url: `${SITE}/blog/` }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="blogindex wrap">
  <h1>Blog</h1>
  <p class="standfirst">Notes from building Rethink Phone in the open: what works, what doesn’t, and how to reproduce it.</p>
  <ol class="list">
${posts.length ? posts.map((p) => `    <li><a href="/blog/${p.slug}/"><time datetime="${p.date}">${fmtDate(p.date)}</time><b>${esc(p.title)}</b><span>${esc(p.summary)}</span></a></li>`).join('\n') : '    <li class="empty">The first post is on its way.</li>'}
  </ol>
</main>
${footer}
</body>
</html>
`);

write('blog/feed.xml', `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${NAME} blog</title>
<link>${SITE}/blog/</link>
<atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
<description>Notes from building Rethink Phone in the open.</description>
<language>en</language>
${posts.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE}/blog/${p.slug}/</link><guid>${SITE}/blog/${p.slug}/</guid><pubDate>${new Date(p.date + 'T09:00:00Z').toUTCString()}</pubDate><description>${esc(p.summary)}</description></item>`).join('\n')}
</channel>
</rss>
`);

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[`${SITE}/`, `${SITE}/blog/`, ...posts.map((p) => `${SITE}/blog/${p.slug}/`)].map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('404.html', blogHead({ title: `Not found · ${NAME}`, description: 'Page not found.', url: `${SITE}/404` }) + `
</head>
<body>
${svgDefs}
${siteHeader}
<main class="blogindex wrap"><h1>Not found.</h1><p class="standfirst">That page doesn’t exist. <a href="/">Go to the home page</a>.</p></main>
</body>
</html>
`);
// long cache for renders and fonts-free assets; HTML always fresh (Cloudflare Pages / Netlify format)
write('_headers', `/assets/*\n  Cache-Control: public, max-age=86400\n/*.html\n  Cache-Control: public, max-age=0, must-revalidate\n`);

console.log(`built ${posts.length} post(s) → ${path.relative(process.cwd(), OUT) || OUT} for ${SITE}`);
