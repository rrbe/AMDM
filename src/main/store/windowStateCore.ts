/**
 * Pure logic for restoring the main window's size/position across launches.
 *
 * Saved bounds can go stale between sessions — an external monitor gets
 * unplugged, the resolution changes, the window was on a display that no longer
 * exists. Restoring them blindly can drop the window fully off-screen where the
 * user can't grab it. `resolveWindowBounds` reconciles the saved geometry with
 * the *currently connected* displays and guarantees a reachable result.
 *
 * No electron / fs imports → unit-testable in isolation (see
 * test/unit/main/windowStateCore.test.ts). The thin side-effecting wrapper that
 * reads/writes disk lives in windowStateStore.ts; the screen plumbing lives in
 * main/index.ts.
 */

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A display's *work area* (screen minus dock/taskbar), in global coords. */
export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowSizeConstraints {
  minWidth: number
  minHeight: number
  defaultWidth: number
  defaultHeight: number
}

/** What `BrowserWindow` is opened with. x/y omitted → OS centers the window. */
export interface ResolvedBounds {
  width: number
  height: number
  x?: number
  y?: number
}

// A window is "reachable" only if at least this big a patch of it lands on some
// display — enough to grab the title bar / traffic lights and drag it back.
const MIN_VISIBLE_W = 120
const MIN_VISIBLE_H = 48

function clampSize(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number | undefined
): number {
  // Only truly invalid values (missing / NaN / Infinity / non-positive) fall
  // back to the default. A small-but-real value is clamped up to the floor
  // instead of discarded — e.g. if minWidth was raised between versions.
  let v = value == null || !Number.isFinite(value) || value <= 0 ? fallback : value
  if (max != null && v > max) v = max
  return Math.max(v, min) // floor wins last — e.g. minWidth > a tiny display's width
}

/** Does the rect overlap any display by at least the min visible patch? */
function isReachable(rect: WindowBounds, displays: DisplayArea[]): boolean {
  return displays.some((d) => {
    const overlapW = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x)
    const overlapH = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y)
    return overlapW >= MIN_VISIBLE_W && overlapH >= MIN_VISIBLE_H
  })
}

/**
 * Reconcile saved bounds with the connected displays. Always returns a usable
 * size (clamped to [min, largest display], falling back to the default when the
 * saved value is missing/garbage). Keeps the saved x/y only when the window
 * would land on-screen; otherwise drops them so the OS re-centers it.
 */
export function resolveWindowBounds(
  saved: Partial<WindowBounds> | null | undefined,
  displays: DisplayArea[],
  c: WindowSizeConstraints
): ResolvedBounds {
  const maxW = displays.length ? Math.max(...displays.map((d) => d.width)) : undefined
  const maxH = displays.length ? Math.max(...displays.map((d) => d.height)) : undefined
  const width = clampSize(saved?.width, c.defaultWidth, c.minWidth, maxW)
  const height = clampSize(saved?.height, c.defaultHeight, c.minHeight, maxH)

  const hasPos = saved != null && Number.isFinite(saved.x) && Number.isFinite(saved.y)
  if (!hasPos) return { width, height }

  const rect: WindowBounds = { x: saved.x as number, y: saved.y as number, width, height }
  return isReachable(rect, displays) ? { width, height, x: rect.x, y: rect.y } : { width, height }
}
