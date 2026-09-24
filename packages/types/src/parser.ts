export interface ResultItem {
  name?: string
  /** Each argument's evaluated value, as the encoder reads it. */
  data: Array<{ [key: string]: any }>
  /**
   * `token` is `token(path)`, the variable reference. `tokenValue` is `token.value(path)`, the
   * literal — distinct because
   * inlining one as the other swaps a themeable reference for a fixed value.
   *
   * Both live in `ParserResult.token`, since every consumer that reads a token *path* out of
   * a result wants both.
   */
  type?: 'css' | 'cva' | 'sva' | 'token' | 'tokenValue' | 'viewTransition' | 'pattern' | 'recipe' | 'jsx-recipe'
  /** The call site, for a stylesheet source map. */
  atomOrigin?: { filePath: string; line: number; column: number }
  /** Root binding range for a token call, as UTF-16 offsets into its file. */
  tokenCalleeRange?: { start: number; end: number }
}

export interface ParserResultInterface {
  all: Array<ResultItem>
  css: Set<ResultItem>
  cva: Set<ResultItem>
  sva: Set<ResultItem>
  token: Set<ResultItem>
  viewTransition: Set<ResultItem>
  recipe: Map<string, Set<ResultItem>>
  pattern: Map<string, Set<ResultItem>>
  filePath: string | undefined
  isEmpty: () => boolean
  toArray: () => Array<ResultItem>
  set: (name: 'cva' | 'css' | 'sva' | 'token', result: ResultItem) => void
  setCss: (result: ResultItem) => void
  setCva: (result: ResultItem) => void
  setSva: (result: ResultItem) => void
  setToken: (result: ResultItem, kind?: 'token' | 'tokenValue') => void
  setViewTransition: (result: ResultItem) => void
  setPattern: (name: string, result: ResultItem) => void
  setRecipe: (name: string, result: ResultItem, unresolved?: ReadonlySet<string>) => void
}

export interface EncoderJson {
  schemaVersion: string
  styles: {
    atomic?: string[]
    recipes?: {
      [name: string]: string[]
    }
    /** Bag class -> the `::view-transition-*` slot styles behind it. */
    viewTransitions?: {
      [className: string]: Record<string, any>
    }
  }
}
