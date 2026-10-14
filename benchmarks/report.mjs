import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, platform, arch, release } from 'node:os'
import { join } from 'node:path'

export function statistics(samples) {
  const values = samples.toSorted((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return {
    count: values.length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    p95: values[Math.ceil(values.length * 0.95) - 1],
    min: values[0],
    max: values.at(-1),
  }
}

export function environmentMetadata(root) {
  return {
    recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0].model,
    runnerNode: process.versions.node,
  }
}

export async function writeReport(directory, report, markdown) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(directory, 'report.md'), markdown)
}
