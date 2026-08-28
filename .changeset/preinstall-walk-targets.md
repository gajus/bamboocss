---
'@bamboocss/node': minor
'@bamboocss/parser': patch
---

Install the modules the resolution walk is going to demand, together rather than one at a time.

Telling the compiler about a file that was not already a member is not a small event: the synthesized config's `files`
list is rewritten and the compiler re-derives its whole program. Timed on a real application, one such update costs
**409ms** — and a build made six hundred of them, one per importer that resolved to a module `include` never matched.

A generated tree is where those come from. An `exclude` that keeps Relay artifacts and generated icons out of extraction
does not stop the application importing them, so the walk reached each one separately and paid for it.

The scan that decides which files to parse already resolves every local import, so it already knows those paths. They
are now installed alongside the inventory in a single update — 3,345 of them on the application measured, with
byte-identical CSS out. Installing is not parsing: nothing here is added to the extraction list, because nothing in it
can originate a call.

`Project#addSourceFiles` is the bulk entry point this uses, and it skips a file the project already holds rather than
overwriting it, so it cannot displace text a bundler installed or a hook rewrote.
