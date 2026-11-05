---
'@bamboocss/eslint-plugin': patch
---

Under oxlint's `jsPlugins`, every rule reads each file's own imports. The rules cached a file's imports by their
`context`, which oxlint creates once per rule and passes to `create` for every file, so each rule kept the imports of
the first file it read: a file after one that imports nothing from bamboo went unread, and one with a `css` of its own
after a bamboo file was read as bamboo's. What `no-hardcoded-color` and the other rules found depended on which files a
run covered — 29 colors in one directory, none in its parent — whatever the thread count.

The imports are cached by the file's `SourceCode` now, one per file in ESLint and, through oxlint's own handling of it,
in oxlint too.
