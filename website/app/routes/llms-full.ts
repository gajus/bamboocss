import { DOC_CATEGORIES } from '@/lib/docs-categories'
import { docsSource } from '@/lib/source'

const CATEGORY_TITLES: Record<(typeof DOC_CATEGORIES)[number], string> = {
  overview: 'Overview',
  installation: 'Installation',
  concepts: 'Concepts',
  theming: 'Theming',
  utilities: 'Utilities',
  customization: 'Customization',
  guides: 'Guides',
  migration: 'Migration',
  references: 'References',
}

export function loader() {
  const sortedPages = [...docsSource.getPages()].sort((a, b) => a.slugs.join('/').localeCompare(b.slugs.join('/')))
  const toc: string[] = []
  const sections: string[] = []

  for (const key of DOC_CATEGORIES) {
    const title = CATEGORY_TITLES[key]
    const categoryPages = sortedPages.filter((page) => page.slugs.join('/').startsWith(key))
    if (categoryPages.length === 0) continue

    toc.push(`\n### ${title}`)
    toc.push(
      ...categoryPages.map((page) => `- [${page.data.title}](#${page.data.title.toLowerCase().replace(/\s+/g, '-')})`),
    )
    sections.push(`\n# ${title}\n`)

    for (const page of categoryPages) {
      const level = page.slugs.length
      sections.push(`
${'#'.repeat(Math.min(level, 6))} ${page.data.title}

${page.data.description || ''}

${page.data.llm}

---`)
    }
  }

  const content = `# Bamboo CSS Complete Documentation

> Bamboo CSS is a build-time, type-safe, zero-runtime CSS-in-JS framework. It prunes unused tokens, tree-shakes the runtime, and folds static styles into plain class strings.

This document contains the complete Bamboo CSS documentation, organized by category for easy navigation.

## Table of Contents
${toc.join('\n')}

---
${sections.join('\n')}

---

_This is the complete Bamboo CSS documentation, automatically generated from the official sources._
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
