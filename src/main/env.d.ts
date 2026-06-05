// Asset imports resolved by electron-vite: `import x from '...?asset'`
// yields the runtime file path of the copied asset.
declare module '*?asset' {
  const src: string
  export default src
}
