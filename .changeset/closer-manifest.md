---
'@bamboocss/node': patch
---

A value imported through a package is evaluated again when a `package.json` appears closer to the importer than the one
it resolved through: one that takes over a `#` import, or the package installed into a nearer `node_modules`. Only the
manifest found was recorded, so the answer cached across transforms went on resolving through the farther one, and the
dev server kept serving the old class until it restarted.

- Each manifest looked for and not found is now recorded with the configuration files an extraction reads, so its
  arrival invalidates what depended on its absence.
- A cached answer checks each file it depends on once per call rather than once per answer: a module four directories
  deep importing 21 values from a package compiles in 1.6ms, where it took 1.9ms before and 2.4ms with the new manifests
  and no such check.
