import { AstroLogo } from '@/icons/astro'
import { NuxtLogo } from '@/icons/nuxt'
import { PreactLogo } from '@/icons/preact'
import { ReactRouterLogo } from '@/icons/react-router'
import { QwikLogo } from '@/icons/qwik'
import { SolidjsLogo } from '@/icons/solid'
import { StorybookLogo } from '@/icons/storybook'
import { SvelteLogo } from '@/icons/svelte'
import { ViteLogo } from '@/icons/vite'
import { VueLogo } from '@/icons/vue'
import { css } from '@/styled-system/css'
import { center, flex, grid } from '@/styled-system/patterns'
import { Link } from 'react-router'

const logoMap = {
  solid: {
    name: 'Solid',
    logo: SolidjsLogo,
    href: '/docs/installation/solidjs',
  },
  vite: {
    name: 'Vite',
    logo: ViteLogo,
    href: '/docs/installation/vite',
  },
  preact: {
    name: 'Preact',
    logo: PreactLogo,
    href: '/docs/installation/preact',
  },
  svelte: {
    name: 'Svelte',
    logo: SvelteLogo,
    href: '/docs/installation/svelte',
  },
  astro: {
    name: 'Astro',
    logo: AstroLogo,
    href: '/docs/installation/astro',
  },
  reactrouter: {
    name: 'React Router',
    logo: ReactRouterLogo,
    href: '/docs/installation/react-router',
  },
  qwik: {
    name: 'Qwik',
    logo: QwikLogo,
    href: '/docs/installation/qwik',
  },
  vue: {
    name: 'Vue',
    logo: VueLogo,
    href: '/docs/installation/vue',
  },
  nuxt: {
    name: 'Nuxt',
    logo: NuxtLogo,
    href: '/docs/installation/nuxt',
  },
  storybook: {
    name: 'Storybook',
    logo: StorybookLogo,
    href: '/docs/installation/storybook',
  },
}

type Props = {
  framework: keyof typeof logoMap
}

export const FrameworkCard = (props: Props) => {
  const { framework } = props
  const { logo: Logo, name, href } = logoMap[framework] ?? {}
  return (
    <div
      className={flex({
        gap: '6',
        position: 'relative',
        direction: { base: 'column', sm: 'row' },
        align: { base: 'flex-start', sm: 'center' },
      })}
    >
      <div
        className={center({
          size: '14',
          mixin: 'offShadow',
          shadowColor: { _dark: 'neutral.700' },
          rounded: 'md',
        })}
      >
        <Logo />
      </div>
      <div>
        <h4 className={css({ fontWeight: 'medium' })}>
          <Link
            to={href}
            className={css({
              _before: {
                content: '""',
                position: 'absolute',
                inset: '0',
              },
            })}
          >
            {name}
          </Link>
        </h4>
      </div>
    </div>
  )
}

export const FrameworkCards = () => {
  return (
    <div className={grid({ columns: 3, gap: '8', mt: '8', mb: '16' })}>
      {Object.keys(logoMap).map((framework) => (
        <FrameworkCard key={framework} framework={framework as keyof typeof logoMap} />
      ))}
    </div>
  )
}
