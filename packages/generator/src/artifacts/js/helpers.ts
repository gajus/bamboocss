import { outdent } from 'outdent'
import helpersMjs from '../generated/helpers.mjs.json' with { type: 'json' }

export function generateHelpers() {
  return {
    js: outdent`
  ${helpersMjs.content}

  export function __spreadValues(a, b) {
    return { ...a, ...b }
  }

  export function __objRest(source, exclude) {
    return Object.fromEntries(Object.entries(source).filter(([key]) => !exclude.includes(key)))
  }

  /**
   * Style-producing calls compile away. Hitting this means \`@bamboocss/vite\` did not fold
   * the call — missing plugin, a file outside \`include\`, or a shape the compiler rejects.
   */
  export function uncompiledStyle(name) {
    throw new Error(
      'bamboocss: ' +
        name +
        '() was not compiled. Add \`bamboocss()\` from \`@bamboocss/vite\` and import \`virtual:bamboo.css\`. See https://bamboocss.com/docs/installation/vite',
    )
  }
  `,
  }
}
