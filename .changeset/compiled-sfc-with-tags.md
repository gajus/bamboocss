---
'@bamboocss/vite': patch
---

A Svelte, Astro or Vue component whose markup holds a `<script>`, `<template>` or `<style>` tag is compiled. The
compiled module carries the tag in a string or a template, as it does for a JSON-LD script in `<svelte:head>`, an Astro
`<script is:inline>` or a `<template>` element. It was taken for a component not yet compiled and skipped, so its
`css()` calls reached the browser, where they throw.
