# Bamboo documentation website

The site uses React Router, Vite, and Velite. Documentation lives in `content/docs/**/*.mdx`; Velite compiles those
pages and their table of contents. React Router prerenders the docs and raw Markdown routes into static assets, with
client-side navigation for the app. Cloudflare serves `build/client` using `wrangler.jsonc`.

## Run locally

From the repository root, follow [the contributor setup](../CONTRIBUTING.md), then run:

```sh
pnpm website dev
```

This starts the Velite content watcher and React Router's Vite dev server together. Open the local URL printed by Vite.
Edit MDX in `website/content/docs`, navigation in `website/src/docs.config.tsx`, and routes in `website/app`.

## Validate and build

Run these commands from the repository root:

```sh
pnpm mdx-check
pnpm website build
pnpm website typecheck
pnpm website lint
```

`mdx-check` validates internal documentation links and headings. The website build first builds Bamboo's workspace
packages, then runs Velite, generates Open Graph images, and builds and prerenders the React Router app. The static
output is `website/build/client`; the temporary server build is removed after prerendering.

The same MDX supplies the `/llms.txt`, `/llms-full.txt`, and `/llms/...` routes. Updating a page updates its rendered
and raw Markdown versions together.
