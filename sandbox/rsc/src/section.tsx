import { css } from '../styled-system/css'

/** A server component the root loads with `import()`, styled with a value nothing else uses. */
export function Section() {
  return <section className={css({ width: '[654.3px]' })}>Loaded on demand.</section>
}
