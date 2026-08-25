import { docs } from '.velite'
import { Breadcrumb } from '@/components/docs/breadcrumb'
import { Header } from '@/components/docs/header'
import { MDXContent } from '@/components/docs/mdx-content'
import { Pagination } from '@/components/docs/pagination'
import { Sidebar } from '@/components/docs/sidebar'
import { Toc } from '@/components/ui/toc'
import { css, cx } from '@/styled-system/css'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'

export function loader({ params }: LoaderFunctionArgs) {
  const slug = (params['*'] ?? '').replace(/\/$/, '')
  const doc = docs.find((candidate) => candidate.slug === `docs/${slug}`)

  if (!doc) {
    throw new Response('Not Found', { status: 404 })
  }

  return { doc, slug }
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: 'Bamboo CSS' }]
  }

  const { doc } = loaderData
  const image = `/og/${doc.slug.replace(/^docs\//, '')}.png`
  const description = doc.description ?? ''
  return [
    { title: `${doc.title} | Bamboo CSS` },
    { name: 'description', content: description },
    { property: 'og:title', content: doc.title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'article' },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: doc.title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ]
}

export default function DocsPage() {
  const { doc, slug } = useLoaderData<typeof loader>()

  return (
    <div
      className={css({
        maxW: '90rem',
        mx: 'auto',
        ps: 'max(env(safe-area-inset-left), 1.5rem)',
        pe: 'max(env(safe-area-inset-right), 1.5rem)',
        display: 'flex',
        position: 'relative',
      })}
    >
      <aside
        className={cx(
          css({
            display: { base: 'none', lg: 'block' },
            flexShrink: '0',
            w: '64',
            position: 'sticky',
            top: 'var(--content-top)',
            height: 'calc(100vh - var(--content-top))',
            overflowY: 'auto',
            pe: '4',
            pb: '4',
          }),
          'scroll-area',
        )}
      >
        <Sidebar slug={slug} />
      </aside>

      <article className={css({ flex: '1', minW: '0', px: { base: '4', lg: '10' }, pt: '8' })}>
        <Breadcrumb slug={slug} />
        <Header doc={doc} />
        <MDXContent code={doc.code} />
        <Pagination slug={slug} />
      </article>

      <div
        className={cx(
          css({
            visibility: 'visible',
            display: { base: 'none', xl: 'block' },
            flexShrink: '0',
            w: '56',
            position: 'sticky',
            top: 'var(--content-top)',
            maxH: 'calc(100vh - var(--content-top))',
            overflowY: 'auto',
          }),
          doc.hideToc && css({ visibility: 'hidden' }),
          'scroll-area',
        )}
      >
        <Toc data={doc.toc} />
      </div>
    </div>
  )
}
