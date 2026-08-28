---
'@bamboocss/ts-ast': patch
'@bamboocss/parser': patch
---

Stop reading files, and re-canonicalising paths, to answer questions resolution already knew.

Profiling an extraction pass over a real application put 45% of it in filesystem syscalls made by this process — more
than the compiler it was waiting on. Three things were doing it:

- `exists()` fell past a delegate's `fileExists` unless it answered `true`, and then **read the file's contents** to
  decide. Resolution is made of misses: one specifier probes nine extensions, then the same nine under `/index`, then
  repeats at every `node_modules` above the importer, and all but one of those paths is absent by construction. A
  delegate that answers at all is now authoritative; the content read remains only for one that supplies no
  `fileExists`.
- The local candidates of a failed lookup were derived per _importer_ rather than per _resolution_. `createResolver`
  memoizes by importing directory and specifier and shares one `ResolvedModule`, so a specifier with fifty probes
  imported by five hundred files re-walked and re-canonicalised that list twenty-five thousand times. It is now derived
  once, keyed weakly on the resolution it describes.
- `isInCheckout` recomputed the checkout boundary on every call, which is a `realpath` — an `lstat` per path component —
  over a root fixed for the life of the project.

Measured over a 300-file slice of that application: 13,378ms to 10,979ms, 18% faster, with file content reads falling
from 15.7% of the profile to 1.5%.
