---
'@bamboocss/node': patch
---

Load the native extractor once per process instead of on every native call. In a published install, each call first
failed to find `@bamboocss/native-extractor`, a package only the workspace has, before falling back to the prebuilt
binary: about 45 µs a call, paid once for every module the Vite plugin compiles and for every extraction pass and token
accounting.
