'use client'
import { dialogSlotRecipe } from '@/components/ui/dialog'
import { ChevronRightIcon } from '@/icons'
import { useMatchMedia } from '@/lib/use-match-media'
import { Code } from '@/mdx/code'
import { css, cx } from '@/styled-system/css'
import { createListCollection } from '@ark-ui/react/collection'
import { Combobox } from '@ark-ui/react/combobox'
import { Dialog } from '@ark-ui/react/dialog'
import { useEnvironmentContext } from '@ark-ui/react/environment'
import { Portal } from '@ark-ui/react/portal'
import { createMarkdownRenderer } from 'fumadocs-core/content/md'
import type { SortedResult } from 'fumadocs-core/search'
import { useDocsSearch } from 'fumadocs-core/search/client'
import { staticClient } from 'fumadocs-core/search/client/orama-static'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { LuHash } from 'react-icons/lu'
import rehypeRaw from 'rehype-raw'
import { useNavigate } from 'react-router'
import { center, flex } from 'styled-system/patterns'

// Result `content` is Markdown with a literal `<mark>` around each matched term
// (fumadocs-core's own highlighting) — rehype-raw + allowDangerousHtml let that survive the
// remark→rehype conversion as a real node instead of being escaped or dropped. Reused as-is: it
// comes from our own indexed docs, never user input.
const mdRenderer = createMarkdownRenderer({
  rehypePlugins: [rehypeRaw],
  remarkRehypeOptions: { allowDangerousHtml: true },
})

const mdComponents = {
  code: Code,
  strong: (props: React.ComponentProps<'strong'>) => <strong className={css({ color: 'fg' })} {...props} />,
  // A row-level snippet, not page prose — render the paragraph's children inline rather than
  // as a block element with its own margin.
  p: (props: React.ComponentProps<'p'>) => <>{props.children}</>,
}

interface Props {
  mediaQuery: string
  trigger: React.ReactNode
  limit?: number
}

interface Item {
  label: string
  // Unique per result — used as the React key and Ark UI's collection identity. Several
  // `text`-type matches (paragraphs) can share one enclosing heading's anchor as their `url`,
  // so `url` alone collides; `result.id` (page_id + index) never does.
  value: string
  url: string
  breadcrumbs: string[]
  type: SortedResult['type']
}

// `breadcrumbs` only arrives on page-level results (see `SharedIndex` — it's built from the
// page tree, which this site doesn't generate). Deriving the same "Docs / Category" shape from
// the URL for every result means a heading or text match still says which section it's from.
const deriveBreadcrumbs = (result: SortedResult): string[] => {
  if (result.breadcrumbs?.length) return result.breadcrumbs
  const [category] = result.url.replace(/^\/docs\//, '').split(/[#/]/)
  return category ? ['Docs', category.charAt(0).toUpperCase() + category.slice(1)] : ['Docs']
}

const toItem = (result: SortedResult): Item => ({
  label: result.content,
  value: result.id,
  url: result.url,
  breadcrumbs: deriveBreadcrumbs(result),
  type: result.type,
})

// Per-type visual weight, mirroring how the TOC and sidebar already use a rail + indent for
// hierarchy. Each branch is a separate, fully static css() call — Bamboo's compiler rejects a
// single call with a runtime-picked field, since that's an open style value it can't resolve
// to a finite class set (see "Dynamic styling" in the docs).
const resultContentStyles = {
  page: css({ minW: '0', fontWeight: 'semibold', color: 'fg' }),
  // Icon sits at insetInlineStart 5 (20px) and is 3.5 (14px) wide, ending at 34px — ps needs to
  // clear that with room to spare, not just match it, or the glyph touches the text.
  heading: css({ minW: '0', ps: '10', fontWeight: 'semibold', color: 'fg' }),
  text: css({ minW: '0', ps: '4', fontWeight: 'normal', color: 'fg.muted' }),
}

// The default `<mark>` is a solid yellow block; underline the match instead so it reads as an
// emphasis on the text rather than a highlighter stroke over it.
const markStyles = css({
  '& mark': {
    bg: 'transparent',
    color: 'accent',
    textDecoration: 'underline',
  },
})

const railStyles = css({
  position: 'absolute',
  insetInlineStart: '3',
  insetBlock: '0',
  w: 'px',
  bg: 'border',
})

// Wraps just the content line (not the breadcrumb row above it), so the icon can center on
// that line specifically via top: 50% — self-adjusting to font-size/line-height, unlike a fixed
// pixel offset measured against one rendering.
const contentWrapStyles = css({ position: 'relative' })

const hashIconStyles = css({
  position: 'absolute',
  insetInlineStart: '5',
  top: '50%',
  transform: 'translateY(-50%)',
  boxSize: '3.5',
  color: 'fg.muted',
})

export const CommandMenu = (props: Props) => {
  const { mediaQuery, trigger, limit = 8 } = props

  const [open, setOpen] = useState(false)

  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: '/static.json' }),
  })

  const results = query.data && query.data !== 'empty' ? query.data : []
  const filteredItems = useMemo(() => results.slice(0, limit).map(toItem), [results, limit])

  const navigate = useNavigate()

  const collection = useMemo(() => createListCollection({ items: filteredItems }), [filteredItems])

  const isMobile = useMatchMedia(mediaQuery)
  useHotkey({ enabled: !isMobile, setOpen })

  const dialogStyles = dialogSlotRecipe({
    size: 'lg',
    placement: isMobile ? 'bottom' : 'top',
  })

  return (
    <Dialog.Root lazyMount unmountOnExit open={open} onOpenChange={(event) => setOpen(event.open)}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop className={dialogStyles.backdrop} />
        <Dialog.Positioner className={dialogStyles.positioner}>
          <Dialog.Content className={dialogStyles.content}>
            <Combobox.Root
              open
              disableLayer
              inputBehavior="autohighlight"
              placeholder="Search the docs"
              selectionBehavior="clear"
              loopFocus={false}
              collection={collection}
              composite={false}
              onValueChange={(e) => {
                const target = filteredItems.find((item) => item.value === e.value[0])
                if (target) navigate(target.url)
                requestAnimationFrame(() => {
                  setOpen(false)
                })
              }}
              onInputValueChange={({ inputValue }) => {
                setSearch(inputValue)
              }}
            >
              <Combobox.Control
                className={css({
                  zIndex: '1',
                  borderBottomStyle: 'solid',
                  borderBottomWidth: '1px',
                  borderColor: 'border',
                  flex: 'none',
                  alignItems: 'center',
                  padding: '0 1rem',
                  display: 'flex',
                  position: 'relative',
                })}
              >
                <Combobox.Input
                  className={css({
                    appearance: 'none',
                    height: '3.5rem',
                    background: 'transparent',
                    flex: 'auto',
                    minWidth: '0',
                    marginLeft: '.75rem',
                    marginRight: '1rem',
                    fontSize: '1rem',
                    outline: '0',
                  })}
                />
              </Combobox.Control>
              <Combobox.Content
                className={cx(
                  'scroll-area',
                  css({
                    p: '1',
                    scrollPaddingTop: '1rem',
                    scrollPaddingBottom: '1rem',
                    overflow: 'auto',
                    maxH: '68vh',
                    overscrollBehavior: 'contain',
                    borderRadius: 'lg',
                    width: '100%',
                    maxWidth: '47.375rem',
                    minHeight: '0',
                    bg: 'bg',
                    flexDirection: 'column',
                    margin: '0 auto',
                    display: 'flex',
                  }),
                )}
              >
                <Combobox.List>
                  {collection.items.length === 0 && (
                    <div className={center({ p: '3', minH: '40' })}>
                      <div className={css({ color: 'fg.muted', mixin: 'sm' })}>
                        No results found for <strong>{search}</strong>
                      </div>
                    </div>
                  )}
                  {collection.items.map((item) => (
                    <Combobox.Item
                      key={item.value}
                      item={item}
                      persistFocus
                      className={css({
                        position: 'relative',
                        height: 'auto',
                        px: '2.5',
                        py: '2',
                        rounded: 'lg',
                        _highlighted: {
                          bg: 'bg.main',
                        },
                      })}
                    >
                      <div className={flex({ align: 'center', gap: '1', mixin: 'xs', color: 'fg.muted', mb: '1' })}>
                        {item.breadcrumbs.map((crumb, index) => (
                          <Fragment key={index}>
                            {index > 0 && <ChevronRightIcon className={css({ boxSize: '3' })} />}
                            <span>{crumb}</span>
                          </Fragment>
                        ))}
                      </div>

                      {item.type !== 'page' && <div aria-hidden className={railStyles} />}

                      <div className={contentWrapStyles}>
                        {item.type === 'heading' && <LuHash aria-hidden className={hashIconStyles} />}

                        <div className={cx(markStyles, resultContentStyles[item.type])}>
                          <mdRenderer.Markdown components={mdComponents}>{item.label}</mdRenderer.Markdown>
                        </div>
                      </div>
                    </Combobox.Item>
                  ))}
                </Combobox.List>
              </Combobox.Content>
            </Combobox.Root>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

interface UseHotkeyProps {
  enabled: boolean
  setOpen: (open: boolean) => void
}

const useHotkey = (props: UseHotkeyProps) => {
  const { enabled, setOpen } = props

  const env = useEnvironmentContext()

  useEffect(() => {
    const document = env.getDocument()
    const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator?.platform)
    const hotkey = isMac ? 'metaKey' : 'ctrlKey'

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() === 'k' && event[hotkey] && enabled) {
        event.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeydown, true)
    return () => {
      document.removeEventListener('keydown', handleKeydown, true)
    }
  }, [env, setOpen, enabled])
}
