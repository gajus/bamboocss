---
'@bamboocss/eslint-plugin': patch
---

Read a `const` the file declares holding a `css()` call as the file's own styles in `no-unlayered-override`. The rule
looked only for a `css()` call written in the join, so it missed `cx(styles, props.className)`, the forwarding the docs
show, and reported `cx(css({ padding: '4' }), styles)`, two of the file's own styles that `cx()` merges, as a join with
a class it cannot see. A name is read as the code reads it, so a parameter that shadows such a binding is still a value
the rule cannot see, and a binding imported from another module is not followed.
