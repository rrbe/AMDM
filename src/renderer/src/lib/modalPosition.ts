/** Keep a moved modal inside the visible viewport. */
export function clampModalPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - width - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - height - margin))
  }
}
