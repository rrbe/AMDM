import methods from 'virtual:mongosh-methods'

/** Keep collection properties from masking official Database methods. */
export const DATABASE_RESERVED = new Set(methods.Database)

export function buildCollectionDecls(names: string[]): string {
  const props = [...new Set(names)]
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && !DATABASE_RESERVED.has(name))
    .map((name) => `  ${name}: Collection;`)
  return props.length ? `interface AmdmCollections {\n${props.join('\n')}\n}\n` : ''
}
