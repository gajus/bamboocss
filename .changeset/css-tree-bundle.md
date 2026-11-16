---
'@bamboocss/core': patch
---

Load css-tree's prebuilt bundle, `css-tree/dist/csstree.esm`, rather than its package entry, so a process that builds
CSS starts faster: the bundle is the same release with the same exports in one file, where the entry is a graph of
modules, and imports in about 8 ms against 27 ms. Loading the engine in a fresh process dropped from 98 ms to 85 ms.
Core is the only package in a build that reads css-tree, and the declarations it validates against are the same.
