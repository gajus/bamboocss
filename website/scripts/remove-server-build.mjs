import { rm } from 'node:fs/promises'

await rm(new URL('../build/server', import.meta.url), { force: true, recursive: true })
