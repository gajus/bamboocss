import { isObjectOrArray, isObject } from './assert'

type Predicate<R = any> = (value: any, path: string[]) => R

export type MappedObject<T, K> = {
  [Prop in keyof T]: T[Prop] extends Array<any>
    ? MappedObject<T[Prop][number], K>[]
    : T[Prop] extends Record<string, unknown>
      ? MappedObject<T[Prop], K>
      : K
}

export type WalkObjectStopFn = (value: any, path: string[]) => boolean

export interface WalkObjectOptions {
  stop?: WalkObjectStopFn
  getKey?(prop: string, value: any): string
  /**
   * What to keep when `getKey` gives two props of one object the same key. Without it the
   * later replaces the earlier, as assigning the key twice would.
   */
  merge?(earlier: any, later: any): any
}

type Nullable<T> = T | null | undefined
const isNotNullish = <T>(element: Nullable<T>): element is T => element != null

export function walkObject<T, K>(
  target: T,
  predicate: Predicate<K>,
  options: WalkObjectOptions = {},
): MappedObject<T, ReturnType<Predicate<K>>> {
  const { stop, getKey, merge } = options

  function inner(value: any, path: string[] = []): any {
    if (isObjectOrArray(value)) {
      const result: Record<string, string> = {}
      for (const [prop, child] of Object.entries(value)) {
        const key = getKey?.(prop, child) ?? prop
        const childPath = [...path, key]
        if (stop?.(value, childPath)) {
          return predicate(value, path)
        }

        const next = inner(child, childPath)
        if (isNotNullish(next)) {
          result[key] = merge && Object.prototype.hasOwnProperty.call(result, key) ? merge(result[key], next) : next
        }
      }
      return result
    }

    return predicate(value, path)
  }

  return inner(target)
}

export function mapObject(obj: any, fn: (value: any) => any) {
  if (Array.isArray(obj)) return obj.map((value) => fn(value))
  if (!isObject(obj)) return fn(obj)
  return walkObject(obj, (value) => fn(value))
}
