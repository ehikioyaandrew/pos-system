/**
 * Bump desktop version, commit, tag, and push → GitHub Action publishes MSI + latest.json.
 *
 * Usage:
 *   node scripts/release-desktop.mjs           # patch bump 1.0.0 → 1.0.1
 *   node scripts/release-desktop.mjs 1.2.0     # set exact version
 *   node scripts/release-desktop.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const confPath = path.join(root, 'src-tauri', 'tauri.conf.json')
const pkgPath = path.join(root, 'package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const explicit = args.find((a) => /^\d+\.\d+\.\d+/.test(a))

function bumpPatch(v) {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
}

const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const current = String(conf.version || pkg.version || '1.0.0')
const next = explicit || bumpPatch(current)

console.log(`Desktop version: ${current} → ${next}`)

if (dryRun) {
  console.log('Dry run — no files changed, no git commands.')
  process.exit(0)
}

conf.version = next
pkg.version = next
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const run = (cmd) => {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

run('git add src-tauri/tauri.conf.json package.json')
run(`git commit -m "release: desktop v${next}"`)
run(`git tag v${next}`)
run('git push')
run(`git push origin v${next}`)

console.log(`
Pushed tag v${next}.
GitHub Action "Publish Desktop" will build the MSI, upload it, and write latest.json
so shop PCs can use Check for updates.
`)
