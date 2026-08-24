/* eslint-disable no-constant-binary-expression -- false guards preserve type checking without running generated styles */
import { assertType, describe, test } from 'vitest'
import { css } from '../../styled-system-strict-property-values/css'

describe('css', () => {
  test('native CSS prop and value', () => {
    assertType(false && css({ display: 'flex' }))

    // @ts-expect-error expected from strictPropertyValues: true
    assertType(false && css({ display: 'abc' }))

    assertType(false && css({ content: 'abc' }))
    assertType(false && css({ willChange: 'abc' }))

    assertType(false && css({ pos: 'absolute' }))

    // @ts-expect-error always expected
    assertType(false && css({ pos: 'absolute123' }))
    assertType(false && css({ flex: '0 1' }))

    assertType(false && css({ borderTop: '1px solid red' }))
    // @ts-expect-error expected
    assertType(false && css({ borderTopStyle: 'aaa' }))
  })

  test('token value', () => {
    assertType(false && css({ color: 'blue.300' }))
  })

  test('css var', () => {
    assertType(false && css({ color: 'var(--button-color)' }))
    assertType(false && css({ display: 'var(--button-color)' }))
  })

  test('utility prop', () => {
    assertType(
      false &&
        css({
          srOnly: true,
        }),
    )
  })

  test('shorthand prop', () => {
    assertType(
      false &&
        css({
          backgroundColor: 'red',
          bg: 'red',
        }),
    )
  })

  test('object condition prop', () => {
    assertType(false && css({ bg: { _hover: 'yellow.100' } }))
  })

  test('condition prop', () => {
    assertType(false && css({ _hover: { bg: 'yellow.200' } }))
  })

  test('nested condition prop', () => {
    assertType(
      false &&
        css({
          _hover: {
            _dark: {
              bg: 'pink',
            },
          },
        }),
    )
  })

  test('arbitrary value', () => {
    assertType(
      false &&
        css({
          color: '#fff',
        }),
    )
  })

  test('arbitrary value escape hatch', () => {
    assertType(
      false &&
        css({
          color: '[#fff]',
          fontSize: '[123px]',
        }),
    )
  })

  test('arbitrary value escape hatch with conditionals', () => {
    assertType(
      false &&
        css({
          color: '[#fff]',
          fontSize: '[123px]',
          bgColor: '[#fff!]',
          borderColor: '[#fff !important]',
          _hover: {
            color: '[#fff]',
            fontSize: '[123px]',
            bgColor: '[#fff!]',
            borderColor: '[#fff !important]',
          },
          backgroundColor: {
            _dark: '[#3B00B9]',
            _hover: '[#3B00B9!]',
            _focus: '[#3B00B9 !important]',
          },
        }),
    )
  })

  test('arbitrary selector', () => {
    assertType(false && css({ ['&:data-bamboo']: { display: 'flex' } }))
  })

  test('important', () => {
    assertType(
      false &&
        css({
          fontSize: '2xl!',
          p: '4 !important',
          bgColor: '#fff!',
          bg: '#fff!',
          borderColor: '#fff !important',
          _hover: {
            fontSize: '2xl!',
            p: '4 !important',
            bgColor: '#fff!',
            borderColor: '#fff !important',
          },
          backgroundColor: {
            _disabled: '2xl!',
            _active: '4 !important',
            _hover: '#3B00B9!',
            _focus: '#3B00B9 !important',
          },
        }),
    )
  })

  test('responsive condition', () => {
    assertType(
      false &&
        css({
          sm: {
            bg: 'purple',
          },
        }),
    )
  })

  test('responsive value prop', () => {
    assertType(
      false &&
        css({
          bg: { base: 'cyan.100', sm: 'cyan.200', xl: 'cyan.300' },
        }),
    )
  })

  test('using inline token helper - in value', () => {
    assertType(
      false &&
        css({
          border: '1px solid token(colors.blue.400)',
        }),
    )
  })

  test('using inline token helper - in condition', () => {
    assertType(false && css({ '@media screen and (min-width: token(sizes.4xl))': { bg: 'blue.500' } }))
  })

  test('nested condition prop with a responsive value', () => {
    assertType(false && css({ _hover: { _dark: { bg: { base: 'pink.100', sm: 'pink.200' } } } }))
  })
})
