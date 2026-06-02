import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { ToolStatus } from '../../shared/types'

/**
 * Common install dirs for the MongoDB Database Tools. We check these explicitly
 * because a GUI-launched Electron app on macOS does NOT inherit the shell PATH,
 * so `which` alone misses Homebrew installs (ADR-0005: detect, don't bundle).
 */
const COMMON_DIRS = [
  '/opt/homebrew/bin', // Apple Silicon Homebrew
  '/usr/local/bin', // Intel Homebrew / manual
  '/usr/bin',
  '/opt/mongodb/bin',
  '/opt/mongodb-database-tools/bin'
]

function resolveTool(name: string): string | undefined {
  // 1) Whatever is on PATH (works when launched from a terminal).
  try {
    const p = execFileSync('which', [name], { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch {
    /* not on PATH */
  }
  // 2) Known install directories (covers GUI-launch PATH gaps).
  for (const dir of COMMON_DIRS) {
    const p = `${dir}/${name}`
    if (existsSync(p)) return p
  }
  return undefined
}

export function getToolStatus(): ToolStatus {
  return { mongodump: resolveTool('mongodump'), mongorestore: resolveTool('mongorestore') }
}

export function requireTool(name: 'mongodump' | 'mongorestore'): string {
  const p = resolveTool(name)
  if (!p) {
    throw new Error(
      `${name} not found. Install the MongoDB Database Tools — e.g. \`brew install mongodb-database-tools\` — then retry. (BSON uses the official tools; other formats work without them.)`
    )
  }
  return p
}
