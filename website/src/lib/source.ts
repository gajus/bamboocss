import { docs, type Docs } from '.velite'
import { buildStructuredData } from './build-structured-data'
import { loader } from 'fumadocs-core/source'
import type { InferPageType, MetaData, PageData, StaticSource, VirtualFile } from 'fumadocs-core/source'

export interface BambooPageData extends PageData {
  title: string
  code: string
  llm: string
  toc: Docs['toc']
  hideToc?: boolean
}

type BambooSourceConfig = { pageData: BambooPageData; metaData: MetaData }

// Bypasses Fumadocs' own path-based slug inference entirely: slugs come straight from Velite's
// `doc.slug`, so today's URLs stay byte-identical by construction, not by coincidence.
const toVirtualFile = (doc: Docs): VirtualFile<BambooSourceConfig> => {
  const slugs = doc.slug.replace(/^docs\//, '').split('/')

  return {
    type: 'page',
    path: `${slugs.join('/')}.mdx`,
    slugs,
    data: {
      title: doc.title,
      description: doc.description,
      code: doc.code,
      llm: doc.llm,
      toc: doc.toc,
      hideToc: doc.hideToc,
      structuredData: () => buildStructuredData(doc),
    },
  }
}

const bambooSource: StaticSource<BambooSourceConfig> = {
  files: docs.map(toVirtualFile),
}

export const docsSource = loader({
  source: bambooSource,
  baseUrl: '/docs',
})

export type DocsPage = InferPageType<typeof docsSource>
