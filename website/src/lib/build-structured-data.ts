import type { Docs } from '.velite'
import type { StructuredData } from 'fumadocs-core/mdx-plugins'

// `{/* ... */}` is a JSX comment — MDX renders it as nothing, mainly used here as a
// `<Tabs>`/`<Tab>` prettier-ignore marker (see installation/*.mdx). This parser has no MDX
// awareness, so it reads that as an ordinary paragraph instead of an inert node, and
// remark-structure indexes it as a content block: a search result whose entire text is the
// literal `{/*  */}` shell once the HTML comment inside is stripped by the stringifier. Safe to
// remove from the whole raw string — text genuinely worth indexing is never written only inside
// a JSX comment, and any occurrence inside a fenced code block is already excluded from
// structuredData regardless (remark-structure's default types don't include `code`).
const JSX_COMMENT = /\{\/\*[\s\S]*?\*\/\}/g

/**
 * Structured data for search indexing, derived from Velite's already-parsed `toc` + raw `llm`
 * text rather than a second MDX/JSX compile. Heading ids are stamped from `doc.toc` (already the
 * ids `rehype-slug` baked into the real page) instead of letting remark-structure derive its own,
 * which could drift from the real anchors.
 *
 * Dynamically imported: this only ever runs from the build-time search-index route, never from a
 * client-rendered path, so `remark`/`remark-gfm` must not reach the browser bundle.
 */
export const buildStructuredData = async (doc: Docs): Promise<StructuredData> => {
  const [{ structure }, { default: remarkGfm }, { visit }] = await Promise.all([
    import('fumadocs-core/mdx-plugins'),
    import('remark-gfm'),
    import('unist-util-visit'),
  ])

  const queue = [...doc.toc]
  const stampHeadingIds = () => (tree: any) => {
    visit(tree, 'heading', (node: any) => {
      const entry = queue.shift()
      if (!entry) return
      node.data ??= {}
      node.data.hProperties ??= {}
      node.data.hProperties.id = entry.id
    })
  }

  return structure(doc.llm.replace(JSX_COMMENT, ''), [remarkGfm, stampHeadingIds])
}
