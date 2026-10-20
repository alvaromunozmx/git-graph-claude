// dist/git-graph.zip: only what the plugin needs, with .claude-plugin/plugin.json at the
// zip's root, as Claude Desktop's Settings → Plugins → Upload a plugin expects.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const zip = join(dist, 'git-graph.zip')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist)
execFileSync('zip', ['-qr', zip, '.claude-plugin/plugin.json', 'hooks', 'types', 'tsconfig.json', 'README.md', 'LICENSE'], { cwd: root, stdio: 'inherit' })
console.log(zip)
