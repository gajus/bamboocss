import { Navbar } from '@/mdx/navbar'
import { css } from '@/styled-system/css'
import { Outlet } from 'react-router'

export default function DocsLayout() {
  return (
    <>
      <Navbar />
      <main
        className={css({
          pt: 'var(--navbar-height)',
          pb: '32',
        })}
      >
        <Outlet />
      </main>
    </>
  )
}
