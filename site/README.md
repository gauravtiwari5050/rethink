# Site

The launch page and experiments. It's a static site: `npm run build` writes everything to `dist/`.

| Path | What it is |
|---|---|
| `index.html` | The launch page. Edit this file; it also previews on its own. |
| `assets/` | Renders, frame sequences, the call recording, `experiments.css`, favicon, social image |
| `experiments/NN-slug.md` | Experiments in Markdown, one per feature |
| `build.mjs` | Wraps the page in a full HTML document, builds the experiments, RSS feed, sitemap, robots.txt and 404 |
| `render/` | Blender 5.2.1 script that renders the concept hardware (`blender -b -P render/phone.py -- <mode> <out>`) |

## Add an experiment

An experiment is a product feature we tried on the real phone. Each one is a file named
`experiments/NN-slug.md`, where `NN` is its number:

```md
---
title: Claude operates the phone
date: 2026-11-22
status: Working          # Working | In progress | Didn’t work
summary: One or two sentences, shown on the index, in the RSS feed and in link previews.
draft: true
---

## What it does
## Try it
## How it works
## Limits
```

Drafts (`draft: true`) are left out of the build. Remove that line to publish. The page appears at
`/experiments/slug/`. The status is shown on the page, so update it as the feature changes.

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
