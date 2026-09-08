import { DOC_CATEGORIES } from './src/lib/docs-categories'
import { docsSource } from './src/lib/source'
import type { Config } from '@react-router/dev/config'

export default {
  ssr: false,
  async prerender() {
    const pages = docsSource.getPages()
    const docRoutes = pages.map((page) => page.url)
    const rawDocRoutes = pages.flatMap((page) => {
      const slug = page.slugs.join('/')
      return [`/llms/${slug}`, `/llms/${slug}.mdx`]
    })

    return [
      '/docs',
      ...docRoutes,
      '/llms.txt',
      '/llms-full.txt',
      '/static.json',
      ...DOC_CATEGORIES.map((category) => `/llms/${category}.txt`),
      ...rawDocRoutes,
    ]
  },
} satisfies Config
