import { clickElement, waitForExpression } from './packagedElectron.mjs'

export const primaryModifier = process.platform === 'darwin' ? 4 : 2

export async function updateRendererSettings(renderer, patch) {
  await renderer.evaluate(`(async () => {
    const settings = await window.api.settings.update(${JSON.stringify(patch)});
    const channel = new BroadcastChannel('amdm-settings');
    channel.postMessage(settings);
    channel.close();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`)
}

export async function pressKey(renderer, key, code, virtualKey, modifiers = 0) {
  const parameters = { key, code, windowsVirtualKeyCode: virtualKey, modifiers }
  await renderer.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...parameters })
  await renderer.call('Input.dispatchKeyEvent', { type: 'keyUp', ...parameters })
}

export async function openQuickSearch(renderer, queriesOnly = false) {
  await pressKey(
    renderer,
    queriesOnly ? 'a' : 'k',
    queriesOnly ? 'KeyA' : 'KeyK',
    queriesOnly ? 65 : 75,
    primaryModifier | (queriesOnly ? 8 : 0)
  )
  await waitForExpression(renderer, 'document.activeElement?.getAttribute("role") === "combobox"')
}

export async function searchQuickly(renderer, text) {
  await pressKey(renderer, 'a', 'KeyA', 65, primaryModifier)
  await renderer.call('Input.insertText', { text })
  await waitForExpression(
    renderer,
    `document.querySelector('[data-quick-search] input')?.value === ${JSON.stringify(text)} && document.querySelector('[data-quick-search] [role=listbox]')?.dataset.searchQuery === ${JSON.stringify(text)} && document.querySelector('[data-quick-search] [role=listbox]')?.getAttribute('aria-busy') === 'false'`
  )
}

export async function selectSearchGroup(renderer, name) {
  const scope = {
    All: 'all',
    Connections: 'connections',
    'Query Tabs': 'queries',
    'Data Tabs': 'data',
    'Saved Queries': 'saved',
    'Query History': 'history'
  }[name]
  await clickElement(
    renderer,
    `document.querySelector('[data-quick-search] button[aria-label="Search group"]')`
  )
  await clickElement(
    renderer,
    `[...document.querySelectorAll('.amdm-select-popup [role=option]')].find(option => option.textContent.trim() === ${JSON.stringify(name)})`
  )
  await waitForExpression(
    renderer,
    `document.activeElement?.getAttribute('role') === 'combobox' && document.querySelector('[data-quick-search] [role=listbox]')?.dataset.searchScope === ${JSON.stringify(scope)} && document.querySelector('[data-quick-search] [role=listbox]')?.getAttribute('aria-busy') === 'false'`
  )
}
