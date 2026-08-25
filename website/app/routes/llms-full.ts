import { docs } from '.velite'

const categories = [
  ['overview', 'Overview'],
  ['installation', 'Installation'],
  ['concepts', 'Concepts'],
  ['theming', 'Theming'],
  ['utilities', 'Utilities'],
  ['customization', 'Customization'],
  ['guides', 'Guides'],
  ['migration', 'Migration'],
  ['references', 'References'],
] as const

export function loader() {
  const sortedDocs = [...docs].sort((a, b) => a.slug.localeCompare(b.slug))
  const toc: string[] = []
  const sections: string[] = []

  for (const [key, title] of categories) {
    const categoryDocs = sortedDocs.filter((doc) => doc.slug.startsWith(`docs/${key}`))
    if (categoryDocs.length === 0) continue

    toc.push(`\n### ${title}`)
    toc.push(...categoryDocs.map((doc) => `- [${doc.title}](#${doc.title.toLowerCase().replace(/\s+/g, '-')})`))
    sections.push(`\n# ${title}\n`)

    for (const doc of categoryDocs) {
      const level = doc.slug.replace('docs/', '').split('/').length
      sections.push(`
${'#'.repeat(Math.min(level, 6))} ${doc.title}

${doc.description || ''}

${doc.llm}

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
