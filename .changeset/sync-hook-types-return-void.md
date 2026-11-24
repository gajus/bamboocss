---
'@bamboocss/types': patch
---

Type the `tokens:created` and `utility:created` hooks as returning `void`. Each plugin's hook runs to completion before
what it configured is read, and nothing waits on a promise one returns, so the type said a hook could be async when only
what it does before its first `await` counts. An `async` hook still type-checks; a linter checking for misused promises
now flags it, as it should.
