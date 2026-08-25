import { index, layout, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('./routes/home.ts'),
  layout('./routes/docs-layout.tsx', [
    route('docs', './routes/docs-index.ts'),
    route('docs/*', './routes/docs-page.tsx'),
  ]),
  route('llms.txt', './routes/llms-index.ts'),
  route('llms-full.txt', './routes/llms-full.ts'),
  route('llms/*', './routes/llms-doc.ts'),
  route('*', './routes/not-found.ts'),
] satisfies RouteConfig
