import type { Plugin } from 'vite'
export function mongoshEditorPlugin(): Plugin
export function mongoshEditorTypes(): {
  files: Record<string, string>
  modules: Record<string, string>
  methods: Record<string, string[]>
  roots: string[]
}
