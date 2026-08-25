import { getPublicUrl } from '@/lib/public-url'

export function loader() {
  const documentSets = [
    [
      'Complete documentation',
      '/llms-full.txt',
      'The complete Bamboo CSS documentation including all concepts, utilities, and guides',
    ],
    ['Overview', '/llms/overview.txt', 'Getting started, browser support, FAQ, and why Bamboo CSS'],
    ['Installation', '/llms/installation.txt', 'Framework-specific installation guides for all supported frameworks'],
    [
      'Concepts',
      '/llms/concepts.txt',
      'Core concepts including patterns, recipes, conditional styles, and responsive design',
    ],
    ['Theming', '/llms/theming.txt', 'Design tokens, text styles, layer styles, and animation styles'],
    ['Utilities', '/llms/utilities.txt', 'All CSS utilities organized by category'],
    ['Customization', '/llms/customization.txt', 'Customizing theme, utilities, patterns, and presets'],
    ['Guides', '/llms/guides.txt', 'Practical guides for specific use cases'],
    ['Migration', '/llms/migration.txt', 'Guides for migrating from other CSS-in-JS libraries'],
    ['References', '/llms/references.txt', 'CLI commands and configuration reference'],
  ]

  const links = documentSets
    .map(([title, path, description]) => `- [${title}](${getPublicUrl(path)}): ${description}`)
    .join('\n')

  return new Response(TEMPLATE.replace('%DOCUMENT_SETS%', links), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

const TEMPLATE = `# Bamboo CSS Documentation for LLMs

> Bamboo CSS is a build-time, type-safe, zero-runtime CSS-in-JS framework. It prunes unused tokens, tree-shakes the runtime, and folds static styles into plain class strings.

## Documentation Sets

This index provides links to documentation organized by topic. Each link contains the full text content for that section, making it easy for LLMs to understand specific aspects of Bamboo CSS.

%DOCUMENT_SETS%

## Notes

- The complete documentation includes all content from the official documentation
- Category-specific documentation files contain only the content relevant to that topic
- The content is automatically generated from the same source as the official documentation
- All code examples and API references are preserved in their original format
`
