/**
 * Lazy shell-script formatter (Prettier standalone). Prettier + its babel/estree
 * plugins are heavy, so — exactly like CodeMirror (ADR-0004 rule 7) — we only
 * pull them in the first time the user hits the format shortcut. Runs entirely
 * in the renderer (no main process); the `browser`/standalone build needs no
 * filesystem or Node config resolution.
 *
 * We format as plain JS (`babel` parser) because shell scripts are JS, and keep
 * the style aligned with the app's own source: no semicolons, single quotes.
 */
export async function formatJs(code: string): Promise<string> {
  const [{ format }, babel, estree] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree')
  ])
  return format(code, {
    parser: 'babel',
    plugins: [babel, estree],
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    printWidth: 90,
    tabWidth: 2
  })
}
