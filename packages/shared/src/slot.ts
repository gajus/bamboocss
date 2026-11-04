export const getSlotRecipes = (recipe: Record<string, any> = {}): Record<string, any> => {
  const init = (slot: string) => ({
    className: [recipe.className, slot].filter(Boolean).join('__'),
    base: recipe.base?.[slot] ?? {},
    variants: {},
    defaultVariants: recipe.defaultVariants ?? {},
    compoundVariants: recipe.compoundVariants ? getSlotCompoundVariant(recipe.compoundVariants, slot) : [],
  })

  const slots = recipe.slots ?? []
  const recipeParts = slots.map((slot: any) => [slot, init(slot)]) as [string, any][]

  for (const [variantsKey, variantsSpec] of Object.entries(recipe.variants ?? {})) {
    for (const [variantKey, variantSpec] of Object.entries(variantsSpec as Record<string, any>)) {
      recipeParts.forEach(([slot, slotRecipe]) => {
        slotRecipe.variants[variantsKey] ??= {}
        slotRecipe.variants[variantsKey][variantKey] = variantSpec[slot] ?? {}
      })
    }
  }

  return Object.fromEntries(recipeParts)
}

export const getSlotCompoundVariant = <T extends { css: any }>(compoundVariants: T[], slotName: string) =>
  compoundVariants
    // `css` is optional in practice: `cva` tolerates a compound without one — its two call
    // sites both guard — and a slot recipe accepts the same config, so reading through it
    // unguarded turned a survivable config into a build crash.
    .filter((compoundVariant) => compoundVariant?.css?.[slotName])
    .map((compoundVariant) => ({ ...compoundVariant, css: compoundVariant.css[slotName] }))

/**
 * The slots a slot recipe's styles name, for one written without `slots`: the keys of `base`, of
 * each variant value and of each compound variant's `css`. Shared by the stylesheet and the
 * compiler, which have to agree on them: the stylesheet worked them out and the compiler took the
 * recipe for a `cva`, so an `sva()` without `slots` was never compiled.
 */
export const inferSlots = (recipe: {
  base?: Record<string, unknown> | undefined
  variants?: Record<string, Record<string, Record<string, unknown> | undefined> | undefined> | undefined
  compoundVariants?: Array<{ css?: Record<string, unknown> | undefined } | null | undefined> | undefined
}): string[] => {
  const slots = new Set<string>()
  Object.keys(recipe.base ?? {}).forEach((name) => {
    slots.add(name)
  })

  // `variants` nests one level deeper than `base` does: `{ size: { sm: { root: {…} } } }`.
  // Reading the keys of `{ sm: … }` collects the variant *value* as a slot, so a recipe
  // with a `size.sm` variant grew a phantom `sm` slot — and then had rules emitted for it.
  Object.values(recipe.variants ?? {}).forEach((values) => {
    Object.values(values ?? {}).forEach((slotStyles) => {
      Object.keys(slotStyles ?? {}).forEach((name) => {
        slots.add(name)
      })
    })
  })

  recipe.compoundVariants?.forEach((compoundVariant) => {
    if (!compoundVariant) return
    Object.keys(compoundVariant.css ?? {}).forEach((name) => {
      slots.add(name)
    })
  })

  return Array.from(slots)
}
