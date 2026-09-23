---
'@bamboocss/config': patch
'@bamboocss/core': patch
---

Fall through to the PostCSS optimizer when every `css:optimize` hook declines, as the hook's contract documents.

The merged hook returned the CSS it was handed rather than `undefined` when no plugin answered — or when the only one
threw — so a project with any plugin defining `css:optimize` skipped PostCSS even when that plugin returned nothing. The
stylesheet shipped unmerged and unminified. A declined hook now falls through; a hook that answers still replaces
PostCSS, so `@bamboocss/plugin-lightningcss` is unaffected.
