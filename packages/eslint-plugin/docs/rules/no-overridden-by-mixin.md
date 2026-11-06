# Disallow a property a mixin written after it in the same object overrides (`@bamboocss/no-overridden-by-mixin`)

❌ This rule is deprecated.

<!-- end auto-generated rule header -->

It reported a property written before a mixin in the same object that the mixin set too, which the mixin replaced while
it applied where its key was written:

```ts
// text-xl/regular: { value: { fontSize: '20px', fontWeight: '400' } }
css({ fontWeight: '300', mixin: 'text-xl/regular' })
```

A mixin is now the base of the style it is applied in. Its declarations come first and the style's own properties after
them, wherever the `mixin` key is written, so the `fontWeight` above is 300 and nothing this rule reported can happen.
It reports nothing, no config turns it on, and it will be removed in the next major version. Remove it from your config.
