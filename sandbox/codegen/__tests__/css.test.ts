import { describe, expect, test } from 'vitest'
import { css } from '../styled-system/css/css'

describe('css', () => {
  test('refuses to resolve a class string at runtime', () => {
    expect(() => css({ display: 'flex' })).toThrow('was not compiled')
    expect(() => css({ color: 'blue.300' })).toThrow('@bamboocss/vite')
  })
})

describe('css.raw', () => {
  test('native CSS prop and value', () => {
    const styles = css.raw({ display: 'flex' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "display": "flex",
      }
    `)
  })

  test('token value', () => {
    const styles = css.raw({ color: 'blue.300' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "color": "blue.300",
      }
    `)
  })

  test('utility prop', () => {
    const styles = css.raw({ srOnly: true })

    expect(styles).toMatchInlineSnapshot(`
      {
        "srOnly": true,
      }
    `)
  })

  test('shorthand prop', () => {
    const styles = css.raw({ bg: 'red' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "bg": "red",
      }
    `)
  })

  test('object condition prop', () => {
    const styles = css.raw({ bg: { _hover: 'yellow.100' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "bg": {
          "_hover": "yellow.100",
        },
      }
    `)
  })

  test('condition prop', () => {
    const styles = css.raw({ _hover: { bg: 'yellow.200' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "_hover": {
          "bg": "yellow.200",
        },
      }
    `)
  })

  test('nested condition prop', () => {
    const styles = css.raw({ _hover: { _dark: { bg: 'pink' } } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "_hover": {
          "_dark": {
            "bg": "pink",
          },
        },
      }
    `)
  })

  test('arbitrary value', () => {
    const styles = css.raw({ color: '#fff' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "color": "#fff",
      }
    `)
  })

  test('arbitrary selector', () => {
    const styles = css.raw({ ['&:data-bamboo']: { display: 'flex' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "&:data-bamboo": {
          "display": "flex",
        },
      }
    `)
  })

  test('responsive condition', () => {
    const styles = css.raw({ sm: { bg: 'purple' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "sm": {
          "bg": "purple",
        },
      }
    `)
  })

  test('responsive value prop', () => {
    const styles = css.raw({ bg: { base: 'cyan.100', sm: 'cyan.200', xl: 'cyan.300' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "bg": {
          "base": "cyan.100",
          "sm": "cyan.200",
          "xl": "cyan.300",
        },
      }
    `)
  })

  test('using inline token helper - in value', () => {
    const styles = css.raw({ border: '1px solid token(colors.blue.400)' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "border": "1px solid token(colors.blue.400)",
      }
    `)
  })

  test('using inline token helper - in condition', () => {
    const styles = css.raw({ '@media screen and (min-width: token(sizes.4xl))': { bg: 'blue.500' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "@media screen and (min-width: token(sizes.4xl))": {
          "bg": "blue.500",
        },
      }
    `)
  })

  test('nested condition prop with a responsive value', () => {
    const styles = css.raw({ _hover: { _dark: { bg: { base: 'pink.100', sm: 'pink.200' } } } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "_hover": {
          "_dark": {
            "bg": {
              "base": "pink.100",
              "sm": "pink.200",
            },
          },
        },
      }
    `)
  })

  test('same prop', () => {
    const styles = css.raw({ bgColor: 'red.100', backgroundColor: 'red.200' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "backgroundColor": "red.200",
        "bgColor": "red.100",
      }
    `)

    const styles2 = css.raw({ backgroundColor: 'red.300', bgColor: 'red.400' })

    expect(styles2).toMatchInlineSnapshot(`
      {
        "backgroundColor": "red.300",
        "bgColor": "red.400",
      }
    `)
  })

  test('merging styles', () => {
    const styles = css.raw({ fontSize: 'sm', bgColor: 'red.500' }, { backgroundColor: 'red.600' })

    expect(styles).toMatchInlineSnapshot(`
      {
        "backgroundColor": "red.600",
        "fontSize": "sm",
      }
    `)
  })

  test('merging styles with nested conditions', () => {
    const styles = css.raw({ fontSize: 'sm', _hover: { color: 'green.100' } }, { _hover: { color: 'green.200' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "_hover": {
          "color": "green.200",
        },
        "fontSize": "sm",
      }
    `)
  })

  test('merging styles with object condition prop', () => {
    const styles = css.raw({ fontSize: 'md' }, { fontSize: { base: 'lg', sm: 'xs' } })

    expect(styles).toMatchInlineSnapshot(`
      {
        "fontSize": {
          "base": "lg",
          "sm": "xs",
        },
      }
    `)
  })

  test('rejects an array argument', () => {
    expect(() =>
      css.raw({ fontSize: 'sm', bgColor: 'red.500' }, [{ backgroundColor: 'red.600' }, { fontSize: '12px' }] as never),
    ).toThrowError('An array is not a style argument.')
  })
})
