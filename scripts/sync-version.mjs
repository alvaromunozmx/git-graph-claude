// `npm version patch|minor|major` bumps package.json; this copies the new version into
// plugin.json and marketplace.json, so the three never disagree.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'))
const write = (file, data) => writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`)

const { version } = read('package.json')
const plugin = read('.claude-plugin/plugin.json')
plugin.version = version
write('.claude-plugin/plugin.json', plugin)
const marketplace = read('.claude-plugin/marketplace.json')
for (const entry of marketplace.plugins) entry.version = version
write('.claude-plugin/marketplace.json', marketplace)
console.log(`plugin.json and marketplace.json → ${version}`)
