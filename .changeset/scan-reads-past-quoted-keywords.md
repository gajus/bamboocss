---
'@bamboocss/vite': patch
'@bamboocss/node': patch
---

Compile a module whose import follows a string or quoted word ending in `from`, `import` or `require`, such as a comment
reading `keep the "import" below first` or an object key `"import"`. Before parsing, the compiler decides from a
module's text whether it can reach Bamboo, and it took that word's closing quote for the start of an import path and
read on to the next quote, the real import's. A module whose only route to Bamboo was that import, a recipe defined in
another file or a workspace design system, was skipped: its recipe calls shipped uncompiled and threw when it loaded.

Extraction's file scan read such text the same way within a line, which could leave a file unread and the classes it
asks for without rules.
