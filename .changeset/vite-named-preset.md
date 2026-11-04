---
'@bamboocss/vite': patch
---

A dev server restarts for an edit to a preset named by path, `presets: ['./preset.ts']`. Only the config's own imports
were declared to Vite, and such a preset is bundled on its own as the config loads, so an edit to it reached neither
Vite's restart nor the plugin's watcher, and the server went on with the old preset until it was restarted by hand. The
loaded config's files are declared once it has loaded.

The config's files are declared with `/` on Windows too, which is how Vite names the file an edit reached; spelled with
`\`, no edit to the config restarted the server there.
