---
'@bamboocss/ts-ast': patch
'@bamboocss/parser': patch
---

Stop pulling type-only imports into the compiler.

`isTypeOnly` read the flag off the node it was given. That is right for a specifier and for an export declaration, both
of which carry it — and wrong for an **import** declaration, which does not: `import type { A } from './a'` puts it on
the import clause. So it answered `false` for every type-only import there is, and did so silently.

Callers written as `if (isTypeOnly(declaration)) continue` therefore skipped nothing on the import side. The
imported-recipe walk descended into modules it had already decided not to read, and resolution installed and parsed each
one — a file erased before anything runs, which cannot contribute a declaration to any stylesheet.

What that costs is set by how a codebase generates its types rather than by how it writes its styles. An application
whose components each import a generated artifact type-only — a Relay fragment key, a GraphQL operation type — pulls its
whole generated tree into the program. On the one this was found in, that was 2,945 files and 35.7 MB of them.

Measured there, over 6,859 files, with byte-identical CSS out:

- extraction: **830s to 116s**, a 7.2x improvement
- files costing over a second: **98 to 6**, the worst of them 152s to 1.2s
- the synthesized config, rewritten once per membership change, went from 300 MB of paths pushed across the compiler
  boundary to 4.5 MB

Resolution now also declines to install a module named only by a type-only declaration, which is worth a further 2.7x on
top of the `isTypeOnly` repair. Only the declaration form is skipped: `import { type A, B }` is a value import that
happens to name a type, and the module behind it is still read for `B`.
