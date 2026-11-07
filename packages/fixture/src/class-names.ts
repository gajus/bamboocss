const MERGE_CODE = /(^|[\s"'`.(,[{])_[\w-]{6}\\?:/g

/**
 * `value` with the merge code taken off each readable utility class, `_AQSe3b:md:w_480px` read as
 * `md:w_480px`: in a class string, in source code holding one, in CSS, where the code's colon is
 * escaped (`._AQSe3b\:md\:w_480px`), or in each string of an array.
 *
 * For tests about something other than naming — what the compiler evaluates, what it refuses, what
 * a watch round rebuilds — whose expectations are the readable names as they have always been
 * written. The code itself is pinned where naming is the subject:
 * `packages/shared/__tests__/atom-name.test.ts` and
 * `packages/core/__tests__/mergeable-class-names.test.ts`. A hashed name has no readable part, and
 * keeps only the five characters of its value; anything that is not a string is left as it is.
 */
export const withoutMergeCodes = <T>(value: T): T =>
  (typeof value === 'string'
    ? value.replace(MERGE_CODE, '$1')
    : Array.isArray(value)
      ? value.map((item) => withoutMergeCodes(item))
      : value) as T
