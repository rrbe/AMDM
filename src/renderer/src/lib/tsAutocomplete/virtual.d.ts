declare module 'virtual:mongosh-types' {
  export const files: Record<string, string>
  export const modules: Record<string, string>
  export const roots: string[]
}
declare module 'virtual:mongosh-methods' {
  const methods: Record<string, string[]>
  export default methods
}
