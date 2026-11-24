---
'@bamboocss/config': patch
'@bamboocss/core': patch
---

Apply what every plugin's `tokens:created` hook configures. The hooks ran one after another across microtasks, and the
tokens were built as soon as the first had run, so a plugin listed after another plugin with a `tokens:created` hook had
its `formatTokenName` and `formatCssVar` ignored, with nothing said: a token spelled its way, such as `$blue-300`, was
left in the CSS as written. Each plugin's hook now runs before the tokens are built, as each `utility:created` hook
already did.

A hook that calls `configure` after an `await` comes too late for the tokens, which are built by then, and is now
reported instead of ignored in silence.
