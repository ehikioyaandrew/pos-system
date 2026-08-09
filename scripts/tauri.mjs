import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

/** Ensure Rust's cargo is on PATH even if the shell was opened before rustup install. */
const cargoBin = path.join(os.homedir(), '.cargo', 'bin')
const delim = path.delimiter
const pathKey = process.env.Path ? 'Path' : 'PATH'
const current = process.env[pathKey] || process.env.PATH || ''
if (!current.toLowerCase().includes(cargoBin.toLowerCase())) {
  process.env[pathKey] = `${cargoBin}${delim}${current}`
  process.env.PATH = process.env[pathKey]
}

const require = createRequire(import.meta.url)
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js')
const args = process.argv.slice(2)
const child = spawn(process.execPath, [tauriCli, ...args], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 1))
