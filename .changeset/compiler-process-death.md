---
'@bamboocss/ts-ast': patch
'@bamboocss/node': patch
---

Report a dead compiler process once, instead of once per file.

Every file is parsed through a single TypeScript 7 process, so a process that ends mid-build — killed by the kernel on a
machine that ran out of memory, or ended by its own panic — makes every remaining file fail with the same
`EPIPE: broken pipe, write`. Extraction caught that per file and carried on, so one event became thousands of
`Failed to parse` lines naming thousands of files that were fine, with the line that explained them buried somewhere
above.

- A channel error is now translated into a `CompilerGoneError` that says the compiler is gone, reports its exit status
  when Node has collected one, and points at the two things that end it: a panic trace on the inherited stderr, or the
  OOM killer when there is no trace.
- The failure is latched, so a project that loses its compiler on file 40 does not go on writing to a closed pipe for
  the remaining 4,000.
- `parseFile` no longer records it in `parseFailures`. That map is a list of files to fix and is cleared only by a file
  parsing successfully, so a compiler death recorded there named the whole inventory and went on naming it after the
  compiler had been replaced.
