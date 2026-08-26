---
'@bamboocss/dev': minor
'@bamboocss/node': minor
'@bamboocss/mcp': minor
---

Stop loading, on every command, the modules only one command uses.

A full build spent about half its time importing modules, before reading a single source file. Three of those imports
were reachable from an entry that bundles, so they were parsed by every invocation — including the ones a build makes
from a Vite `buildStart`. Deferring them takes a cold build from ~480ms to ~395ms, and `bin/cli-default` from 339 kB to
26 kB.

- `update-notifier` is dynamic now, and only runs where a TTY could show the notice. It costs nothing to _run_ — the
  registry check is a detached child — but it carries semver, configstore and boxen, and a build has no reader: the CLI
  runs with `stdio: 'ignore'`, or in CI where the box lands in a log nobody opens.
- `@clack/prompts` loads inside `init -i`, the one path that prompts.
- `@bamboocss/reporter` loads inside `analyze`. It is one command, but the module sits behind `@bamboocss/node`'s index,
  so the CLI on any command and the Vite plugin on every build were loading the report formatters to run neither.

**`analyze()` is now async.** Deferring the import is what makes it so; `await` it. This is a breaking change to
`@bamboocss/node`'s API, released as a minor deliberately — it is one function, on the CLI's `analyze` command and the
MCP server's analysis tool, both updated here.

What remains is the wall: TypeScript and ts-morph are ~104ms of the ~215ms still spent importing, and extraction needs
them. Trimming around that is close to done.
