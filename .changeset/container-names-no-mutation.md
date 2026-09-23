---
'@bamboocss/core': patch
---

Stop container setup from writing into `theme.containerNames`.

Building the container conditions prepended `''` — the anonymous name behind `@/sm`, `@/md`, … — to the configured array
itself, so the user's config came back as `['', 'sidebar', …]`. Every later reader of the config saw the extra entry,
and a second context over the same config object added another. The name is now prepended to a copy.
