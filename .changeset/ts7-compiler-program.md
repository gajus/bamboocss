---
'@bamboocss/ts-ast': minor
---

Open the compiler on bamboo's own config, and install a project's inventory in one call.

Two costs, both paid per `Project`, and bamboo builds one per context.

**The program.** Opening the user's `tsconfig.json` builds the program it describes: every file its `include` reaches,
every `@types` package, the standard library, and the transitive closure of every import. bamboo reads none of that. It
never asks a type question — `no-language-service` pins that — and it resolves modules itself, so the compiler is here
to parse the files it is handed and nothing else.

So it is opened on a config bamboo writes to its own virtual disk: `files` naming exactly the installed set, `noResolve`
so imports do not drag more in, and `noLib` with `types: []` for the library a checker would read. Measured on one file
inside this repository:

| opened on                   | compiler RSS |
| --------------------------- | ------------ |
| the repository's `tsconfig` | 2023 MB      |
| bamboo's synthesized config | 19 MB        |

The same tree is parsed either way. `openFiles` is deliberately not used for this: it is the LSP's way in, and it
searches ancestor directories for a tsconfig containing the file — inside any real checkout it finds the user's, and
loads that whole project again.

**The round trips.** Membership is that config's `files` list, so installing a source is an edit to it. Announced one
file at a time, a 2,000-file project is 2,000 round trips each carrying a list one entry longer than the last —
quadratic, and paid on every cold build. It measured **65x slower than ts-morph** before this. `addSourceFiles` takes
the inventory in one call, and single edits defer until something reads, so a bulk install is a single update:

| 2,000 files, build a program and walk every node | mean   |
| ------------------------------------------------ | ------ |
| ts-morph                                         | 482 ms |
| TypeScript 7, one install at a time              | 36.9 s |
| TypeScript 7, batched                            | 206 ms |

Also here: a `Project` owns a compiler process and nothing was closing them. `dispose()` closes one, an abandoned
candidate closes itself, and a project that becomes unreachable is closed by a `FinalizationRegistry` — with a
process-exit hook for whatever is still open when the run ends.
