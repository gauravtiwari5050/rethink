# Site

The launch page and blog. It's a static site: `npm run build` writes everything to `dist/`.

| Path | What it is |
|---|---|
| `index.html` | The launch page. Edit this file; it also previews on its own. |
| `assets/` | Renders, frame sequences, the call recording, `blog.css`, favicon, social image |
| `blog/posts/*.md` | Blog posts in Markdown |
| `build.mjs` | Wraps the page in a full HTML document, builds the blog, RSS feed, sitemap, robots.txt and 404 |
| `render/` | Blender 5.2.1 script that renders the concept hardware (`blender -b -P render/phone.py -- <mode> <out>`) |

## Write a post

Create `blog/posts/YYYY-MM-DD-some-slug.md`:

```md
---
title: The title
date: 2026-11-22
summary: One or two sentences, shown on the index, in the RSS feed and in link previews.
author: Gaurav Tiwari
draft: true
---

Markdown body…
```

Posts with `draft: true` are left out of the build. Remove that line to publish. The URL is `/blog/some-slug/`.

## Preview and build

```sh
npm ci
npm run dev     # includes drafts, serves http://localhost:8080
npm run build   # production build into dist/ (SITE_URL defaults to https://rethinkphone.tech)
```

## Hosting

Cloudflare Pages builds on every push to `main`:

| Setting | Value |
|---|---|
| Root directory | `site` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |
| Environment | `SITE_URL=https://rethinkphone.tech`, `NODE_VERSION=20` |
