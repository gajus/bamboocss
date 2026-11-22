---
'@bamboocss/dev': patch
'@bamboocss/node': patch
'@bamboocss/core': patch
'@bamboocss/vite': patch
---

Say when nothing imports `virtual:bamboo.css` before the build fails on it, and make `bamboo init` write a config and a
`.gitignore` that fit the project.

- A dev server whose modules compiled to Bamboo classes, with nothing importing the stylesheet, says so once it has
  served the page and gone quiet:
  `src/app.tsx was compiled to Bamboo class values, but nothing has imported "virtual:bamboo.css", so it renders unstyled`.
  It said nothing, the page rendered unstyled, and only `vite build` failed.
- `bamboo doctor` reports a project that registers `@bamboocss/vite` and whose files never import `virtual:bamboo.css`.
  The import is found wherever it is: an entry module outside `include`, `.storybook/preview.ts`, `nuxt.config.ts`.
- The build's error no longer says class values were compiled when none were. It fails the same: the stylesheet also
  holds the tokens a compiled `token()` reads, preflight and global styles.
- `bamboo init` writes the `include` the project's installation guide gives, read off `package.json`. It wrote
  `./src/**` and `./pages/**` for JS and TS files whatever the project was, which missed React Router's `app/`, a Nuxt
  project's folders, and every `.vue`, `.svelte` and `.astro` file, so the build failed on the first module it compiled
  there. The next steps it prints link the framework's guide.
- `bamboo init --cwd <dir>` updates the `.gitignore` of the project it names. It looked from the folder the command ran
  in, and created one there when it found none. The file is now the nearest one inside the project's repository, or a
  new one beside the config, never one beyond the repository; and its line is relative to it, so a nested app's
  `src/styled-system` is written `apps/web/src/styled-system` in the repository's `.gitignore`.
