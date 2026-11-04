import { describe, expect, test } from 'vitest'
import { prepareAstroTemplate } from '../src/astro-template'

const frontmatter = `---\nconst x = 'a'\n---\n`

describe('a regex in an expression', () => {
  test('has what Astro reads as syntax escaped, matching the same characters', () => {
    expect(prepareAstroTemplate(`<p>{x.replace(/}/g, '')}</p>`)).toBe(`<p>{x.replace(/\\x7d/g, '')}</p>`)
    expect(prepareAstroTemplate(`<p>{x.replace(/[{}\`'"]/g, '')}</p>`)).toBe(
      `<p>{x.replace(/[\\x7b\\x7d\\x60\\x27\\x22]/g, '')}</p>`,
    )
    expect(prepareAstroTemplate(`<p title={/}/.source} />`), 'in an attribute').toBe(`<p title={/\\x7d/.source} />`)
    expect(prepareAstroTemplate('<p>{`${/}/.source}`}</p>'), 'in a template literal').toBe(
      '<p>{`${/\\x7d/.source}`}</p>',
    )
    expect(prepareAstroTemplate(`<p>{[x].map((s) => <b title={s.replace(/{/, '')} />)}</p>`), 'in an element').toBe(
      `<p>{[x].map((s) => <b title={s.replace(/\\x7b/, '')} />)}</p>`,
    )
    expect(prepareAstroTemplate(`<p>{x ? /}/ : typeof /{/}</p>`), 'after an operator, or a keyword').toBe(
      `<p>{x ? /\\x7d/ : typeof /\\x7b/}</p>`,
    )
  })

  // An operand, after which a `/` divides: a postfix operator leaves one, and so does a property
  // spelled as a keyword. Read as a regex, the `}` after them was escaped and the file broke.
  test.each([
    ['an assertion', '<p>{total! / count}</p>'],
    ['an increment', '<p>{a++ / 2}{b / 3}</p><p>{a-- / 2}{b / 3}</p>'],
    ['a property spelled as a keyword', '<p>{x.in / 2}{x?.do / 2}{x.typeof / 3}</p>'],
    ['a number with a fraction', '<p>{1.5 / 2}{x / 3}</p>'],
  ])('divides after %s', (_, source) => {
    expect(prepareAstroTemplate(source)).toBe(source)
  })

  test('begins after a prefix operator', () => {
    expect(prepareAstroTemplate('<p>{!/}/.test(x)}</p>')).toBe('<p>{!/\\x7d/.test(x)}</p>')
    expect(prepareAstroTemplate('<p>{x !== /}/}</p>')).toBe('<p>{x !== /\\x7d/}</p>')
  })

  test('keeps a quantifier, and what is escaped already', () => {
    for (const regex of ['/a{2}/', '/a{2,}/', '/a{2,3}/u', '/\\}/', '/\\x7d/', '/a\\/b/']) {
      const source = `<p>{x.replace(${regex}, '')}</p>`
      expect(prepareAstroTemplate(source), regex).toBe(source)
    }
  })
})

describe('what is left as it is', () => {
  test.each([
    ['a division', '<p>{a / b / c}</p><p>{(a) / 2}</p><p>{a[0] / 2}</p>'],
    ['a slash in text, between expressions', '<p>{a}/{b} and/or {c}</p>'],
    ['a string', `<p>{'/}/' + "/{/"}</p>`],
    ['a comment', '<p>{/* /}/ */ x}</p><p>{x // /}/\n}</p><!-- {/}/} -->'],
    ['the frontmatter', `---\nconst r = /}/g\n---\n<p>{x}</p>`],
    ['a script and a style', '<script>const r = /}/</script><style>a { b: c }</style><script is:inline>/{/</script>'],
    ['an element of raw text', '<pre is:raw>{/}/}</pre>'],
    ['text in an element in an expression', "<p>{x && <i>don't / won't {x}</i>}</p>"],
    ['a quoted attribute', '<a href="/}/" title=\'/{/\'>x</a>'],
    // The frontmatter ends at a fence of its own line, not at one in a string of it.
    ['the frontmatter, past a fence in a string', "---\nconst s = `\n---`\nconst o = { r: /'/ }\n---\n<p>{x}</p>"],
  ])('%s', (_, source) => {
    expect(prepareAstroTemplate(source)).toBe(source)
  })

  test('a component with neither, as the same string', () => {
    const source = `${frontmatter}<main class={css({ color: 'red' })}>{[1].map((n) => <b>{n}</b>)}</main>\n`
    expect(prepareAstroTemplate(source)).toBe(source)
  })
})

describe('nodes side by side in an expression', () => {
  test('are put in one fragment', () => {
    expect(prepareAstroTemplate('<p>{cond && ( <a /> <b /> )}</p>')).toBe('<p>{cond && ( <><a /> <b /> </>)}</p>')
    expect(prepareAstroTemplate('<p>{ <a /> <b /> }</p>'), 'alone').toBe('<p>{ <><a /> <b /> </>}</p>')
    expect(prepareAstroTemplate('<p>{c ? ( <a /> text ) : ( <b /> {x} )}</p>'), 'with text, or an expression').toBe(
      '<p>{c ? ( <><a /> text </>) : ( <><b /> {x} </>)}</p>',
    )
    expect(prepareAstroTemplate('<p>{c && ( <a /> (see) )}</p>'), 'parentheses in text').toBe(
      '<p>{c && ( <><a /> (see) </>)}</p>',
    )
    expect(prepareAstroTemplate("<p>{c && (<a />\n<!-- it's -->\n<b />)}</p>"), 'a comment between them').toBe(
      "<p>{c && (<><a />\n<!-- it's -->\n<b /></>)}</p>",
    )
    expect(prepareAstroTemplate('<p>{c && (<Foo a=b/> <i/>)}</p>'), 'one closed after an unquoted value').toBe(
      '<p>{c && (<><Foo a=b/> <i/></>)}</p>',
    )
  })

  test('with a regex among them', () => {
    expect(prepareAstroTemplate('<p>{c && ( <a title={/}/.source} /> <b /> )}</p>')).toBe(
      '<p>{c && ( <><a title={/\\x7d/.source} /> <b /> </>)}</p>',
    )
  })

  test.each([
    ['one alone', '<p>{c && ( <a /> )}</p>'],
    ['arguments', '<p>{fn( <a />, <b /> )}</p>'],
    ['adjacent, which Astro groups itself', '<p>{c && <a /><b />}</p>'],
    ['an expression going on', '<p>{( <a /> as any )}</p><p>{( <a /> && <b /> )}</p>'],
  ])('but not %s', (_, source) => {
    expect(prepareAstroTemplate(source)).toBe(source)
  })
})
