import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('./routes/home.tsx'),
  route('api/share', './routes/api.share.ts'),
  route('cdn', './routes/cdn.ts'),
  route(':id', './routes/session.tsx'),
  route(':id/:id2', './routes/session-diff.tsx'),
] satisfies RouteConfig
