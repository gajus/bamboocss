---
'@bamboocss/core': patch
---

Type the `containerName` utility against `theme.containerNames`, as the docs already said it was.

The utility declares `values: 'containerNames'`, but container names are a plain list in the theme rather than a token
category, so looking them up in the token dictionary found nothing and `containerName` was typed as the bare CSS
property. They are now resolved the way `keyframes` are for `animationName`, so a project with
`containerNames: ['sidebar', 'content']` gets `'sidebar' | 'content'` suggested. Any other CSS value is still accepted,
and the emitted CSS is unchanged.
