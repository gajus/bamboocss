// Single source of truth for the top-level doc categories, shared by react-router.config.ts,
// llms-doc.ts and llms-full.ts so the list can't drift between them the way it already had
// (all three independently hand-typed this list, and all three were missing the real `ai`
// category, which the prerender enumeration needs to reach `/llms/ai.txt` at all).
export const DOC_CATEGORIES = [
  'overview',
  'installation',
  'concepts',
  'theming',
  'utilities',
  'customization',
  'guides',
  'migration',
  'references',
] as const
