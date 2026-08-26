#!/usr/bin/env node

import { handleError } from './errors'
import { main } from './cli-main'

import { name, version } from '../package.json'

/**
 * The update notice, only where someone can read it.
 *
 * `update-notifier` costs nothing to *run* — the registry check is a detached child — but it
 * carries semver, configstore and boxen, and this entry is bundled, so every invocation paid
 * to parse that tree whether or not a notice could ever be shown. A build does not have a
 * reader: the CLI runs from a Vite `buildStart` with `stdio: 'ignore'`, or in CI where the box
 * lands in a log nobody opens. Gating on a TTY and importing dynamically keeps the tree in a
 * chunk that only an interactive run loads.
 */
if (process.stdout.isTTY) {
  void import('update-notifier')
    .then(({ default: updateNotifier }) => updateNotifier({ pkg: { name, version }, distTag: 'latest' }).notify())
    .catch(() => void 0)
}

main().catch(handleError)
