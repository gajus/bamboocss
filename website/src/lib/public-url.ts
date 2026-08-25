export function getPublicUrl(path = '') {
  const host =
    import.meta.env.VITE_VERCEL_ENV === 'production'
      ? import.meta.env.VITE_VERCEL_PROJECT_PRODUCTION_URL
      : import.meta.env.VITE_VERCEL_URL
  const vercelUrl = host ? `https://${host}` : undefined
  const publicUrl = import.meta.env.VITE_PUBLIC_URL || vercelUrl
  return `${publicUrl || 'http://localhost:3000'}${path}`
}
