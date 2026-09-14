import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const resolve = (val: string) => new URL(val, import.meta.url).pathname

// Packs the Vite and Node packages into a consumer, and first builds any of them whose `dist` has
// no declarations — in a CI shard, where `prepare` only ran `build-fast`, that is every one. tsdown
// deletes a package's `dist` entry for much of its build, and a test importing that package inside
// the window hangs instead of failing: the eslint plugin's synckit worker loads `@bamboocss/config`
// and `@bamboocss/generator` from `dist` when it starts, and a worker that never starts leaves the
// test blocked in `Atomics.wait`. `Unit Tests 2/3` ran into its 20-minute timeout that way. So this
// file is its own project in a later group, and starts only after every other file in the run — or
// in the shard — has finished.
const packedConsumerTest = 'packages/vite/__tests__/built-package-consumer.test.ts'

export default defineConfig({
  root: process.cwd(),
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    testTimeout: 15_000,
    setupFiles: ['tests-setup.ts'],
    // Tells @bamboocss/eslint-plugin's synckit worker to build its context from
    // the test fixtures instead of discovering a real bamboo config on disk.
    env: {
      BAMBOO_ESLINT_TEST_CONTEXT: new URL('./packages/eslint-plugin/tests/fixtures/create-context.ts', import.meta.url)
        .href,
      // synckit waits on its worker without a timeout, so a worker that dies before answering
      // blocks the test file until the CI job's own limit. Fail within a minute instead.
      SYNCKIT_TIMEOUT: '60000',
    },
    hideSkippedTests: true,
    environment: 'happy-dom',
    // `pnpm bench`. Benchmarks are reported, not asserted — wall-clock numbers are
    // machine- and load-dependent, so they are not part of `pnpm check` or CI. To
    // measure a change, take a baseline on the same machine and compare against it:
    //
    //   pnpm bench:baseline   # on the unchanged tree
    //   pnpm bench:compare    # on the changed tree
    //
    // The bench scripts pass --no-file-parallelism: the default worker pool runs
    // bench files concurrently, and the resulting CPU contention inflates rme far
    // past the effect sizes these are meant to catch.
    benchmark: {
      include: ['{packages,sandbox}/*/__tests__/**/*.bench.ts'],
      outputJson: 'bench/latest.json',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, packedConsumerTest],
        },
      },
      {
        // Not `extends: true`. An extending project appends to the arrays it inherits, so it would
        // collect every benchmark above as well, and `pnpm bench` would run each one twice. The file
        // imports nothing from the workspace, so it needs none of the shared setup.
        test: {
          name: 'packed-consumer',
          include: [packedConsumerTest],
          testTimeout: 15_000,
          benchmark: { include: [] },
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  resolve: {
    alias: [
      {
        find: '@bamboocss/config/ts-path',
        replacement: resolve('./packages/config/src/resolve-ts-path-pattern.ts'),
      },
      {
        find: '@bamboocss/node/static-compiler',
        replacement: resolve('./packages/node/src/static-compiler.ts'),
      },
      {
        find: '@bamboocss/dev',
        replacement: resolve('./packages/cli/src'),
      },
      {
        find: /^@bamboocss\/(.*)$/,
        replacement: resolve('./packages/$1/src'),
      },
    ],
  },
})
