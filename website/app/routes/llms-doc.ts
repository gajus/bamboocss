import { docs } from '.velite'
import type { LoaderFunctionArgs } from 'react-router'

const categoryTitles: Record<string, string> = {
  overview: 'Bamboo CSS Overview',
  installation: 'Bamboo CSS Installation Guides',
  concepts: 'Bamboo CSS Core Concepts',
  theming: 'Bamboo CSS Theming',
  utilities: 'Bamboo CSS Utilities',
  customization: 'Bamboo CSS Customization',
  guides: 'Bamboo CSS Guides',
  migration: 'Bamboo CSS Migration Guides',
  references: 'Bamboo CSS References',
}

export function loader({ params }: LoaderFunctionArgs) {
  const path = params['*'] ?? ''
  const slug = path.replace(/\.(?:mdx|txt)$/, '')

  if (slug.includes('/')) {
    const doc = docs.find((candidate) => candidate.slug === `docs/${slug}`)
    if (!doc) throw new Response('Not Found', { status: 404 })

    return text(`# ${doc.title}

${doc.description || ''}

${doc.llm}

---

_This content is automatically generated from the official Bamboo CSS documentation._
`)
  }

  const categoryDocs = docs
    .filter((doc) => doc.slug.startsWith(`docs/${slug}/`))
    .sort((a, b) => a.slug.localeCompare(b.slug))
  if (categoryDocs.length === 0) throw new Response('Not Found', { status: 404 })

  const sections = categoryDocs
    .map((doc) => {
      const level = doc.slug.replace('docs/', '').split('/').length - 1
      return `${'#'.repeat(Math.min(level + 1, 6))} ${doc.title}

${doc.description || ''}

${doc.llm}`
    })
    .join('\n\n---\n\n')

  return text(`# ${categoryTitles[slug] || slug}

> This document contains all ${slug} documentation for Bamboo CSS

## Table of Contents

${categoryDocs.map((doc) => `- [${doc.title}](#${doc.title.toLowerCase().replace(/\s+/g, '-')})`).join('\n')}

---

${sections}

---

_This content is automatically generated from the official Bamboo CSS documentation._
`)
}

function text(content: string) {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
