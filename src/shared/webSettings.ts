import {
  DEFAULT_SETTINGS,
  HISTORY_LIMITS,
  QUERY_LIMITS,
  QUERY_TIMEOUTS_MS,
  type AppSettings,
} from "./types";
import { isValidTimeZone } from "./timeZones";

export function mergeWebSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  if (Object.keys(patch).some((key) => !allowed.has(key)))
    throw new Error("Invalid settings patch.");
  const next = { ...current, ...patch };
  const numbers = [
    next.sidebarWidth,
    next.editorHeight,
    next.queryLimit,
    next.queryTimeoutMS,
    next.historyLimit,
    next.editorFontSize,
    next.dataFontSize,
    next.editorTabSize,
    next.contextPanelWidth,
  ];
  if (
    !Array.isArray(next.connectionOrder) ||
    !next.connectionOrder.every((item) => typeof item === "string") ||
    !["natural", "alpha", "alphaDesc"].includes(next.collectionSort) ||
    !["natural", "alpha", "alphaDesc"].includes(next.resultFieldSort) ||
    typeof next.resultIdFirst !== "boolean" ||
    !["light", "dark", "system"].includes(next.theme) ||
    !["system", "en", "zh-CN", "zh-TW"].includes(next.language) ||
    !(next.dateTimeZone === "system" || isValidTimeZone(next.dateTimeZone)) ||
    numbers.some((item) => !Number.isFinite(item)) ||
    !QUERY_LIMITS.includes(next.queryLimit as (typeof QUERY_LIMITS)[number]) ||
    !QUERY_TIMEOUTS_MS.includes(
      next.queryTimeoutMS as (typeof QUERY_TIMEOUTS_MS)[number],
    ) ||
    !HISTORY_LIMITS.includes(
      next.historyLimit as (typeof HISTORY_LIMITS)[number],
    ) ||
    next.sidebarWidth < 200 ||
    next.sidebarWidth > 10_000 ||
    next.editorHeight < 80 ||
    next.editorHeight > 10_000 ||
    next.editorFontSize < 9 ||
    next.editorFontSize > 28 ||
    next.dataFontSize < 9 ||
    next.dataFontSize > 28 ||
    ![2, 4].includes(next.editorTabSize) ||
    typeof next.editorWordWrap !== "boolean" ||
    typeof next.activeEditorColorSchemeId !== "string" ||
    !Array.isArray(next.editorColorSchemes) ||
    typeof next.exportIncludeRealPassword !== "boolean" ||
    typeof next.contextPanelOpen !== "boolean" ||
    next.contextPanelWidth < 200 ||
    next.contextPanelWidth > 10_000 ||
    !["inline", "grouped", "auto"].includes(next.tableNestedDisplay) ||
    typeof next.keyboardShortcutsEnabled !== "boolean" ||
    !Array.isArray(next.disabledKeyboardShortcuts) ||
    next.disabledKeyboardShortcuts.some(
      (id) =>
        ![
          "newConnection",
          "newQuery",
          "tabSearch",
          "quickSearch",
          "contextualTabs",
          "resultView",
          "openSettings",
        ].includes(id),
    )
  ) {
    throw new Error("Invalid settings patch.");
  }
  return next;
}
