import { DOC_CATEGORIES } from '@/lib/docs-categories'
import { docsSource } from '@/lib/source'
import type { LoaderFunctionArgs } from 'react-router'

const categoryTitles: Record<(typeof DOC_CATEGORIES)[number], string> = {
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
    const page = docsSource.getPage(slug.split('/'))
    if (!page) throw new Response('Not Found', { status: 404 })

    return text(`# ${page.data.title}

${page.data.description || ''}

${page.data.llm}

---

_This content is automatically generated from the official Bamboo CSS documentation._
`)
  }

  const categoryPages = docsSource
    .getPages()
    .filter((page) => page.slugs.join('/').startsWith(`${slug}/`))
    .sort((a, b) => a.slugs.join('/').localeCompare(b.slugs.join('/')))
  if (categoryPages.length === 0) throw new Response('Not Found', { status: 404 })

  const sections = categoryPages
    .map((page) => {
      const level = page.slugs.length - 1
      return `${'#'.repeat(Math.min(level + 1, 6))} ${page.data.title}

${page.data.description || ''}

${page.data.llm}`
    })
    .join('\n\n---\n\n')

  const title = (categoryTitles as Record<string, string>)[slug] || slug

  return text(`# ${title}

> This document contains all ${slug} documentation for Bamboo CSS

## Table of Contents

${categoryPages.map((page) => `- [${page.data.title}](#${page.data.title.toLowerCase().replace(/\s+/g, '-')})`).join('\n')}

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
