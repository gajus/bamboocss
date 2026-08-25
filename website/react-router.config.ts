import type { Config } from '@react-router/dev/config'

const categories = [
  'overview',
  'installation',
  'concepts',
  'theming',
  'utilities',
  'customization',
  'guides',
  'migration',
  'references',
]

export default {
  ssr: true,
  async prerender() {
    const { docs } = await import('./.velite/index.js')
    const docRoutes = docs.map((doc) => `/${doc.slug}`)
    const rawDocRoutes = docs.flatMap((doc) => {
      const slug = doc.slug.replace(/^docs\//, '')
      return [`/llms/${slug}`, `/llms/${slug}.mdx`]
    })

    return [
      ...docRoutes,
      '/llms.txt',
      '/llms-full.txt',
      ...categories.map((category) => `/llms/${category}.txt`),
      ...rawDocRoutes,
    ]
  },
} satisfies Config
