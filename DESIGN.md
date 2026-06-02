# Mongo Shell GUI — Design System

**Codename: Pine.** A warm, editorial take on a developer database tool. Light-first, with a warm dark counterpart. The goal is to feel *crafted and intentional* — not the default "AI SaaS" template (generic blue, Inter, soft rounded cards on cold gray).

Three principles drive every decision:

1. **Warm neutrals, not cold.** Backgrounds carry a paper/parchment warmth in light and a warm-charcoal warmth in dark. No pure `#fff`, no pure `#000`.
2. **Editorial structure.** Strong typographic hierarchy, an ink hairline rule under the title bar and table headers, uppercase letter-spaced labels. Sharp-ish corners (4px), flat surfaces, restraint over decoration.
3. **Readability for data work.** Compact density, a true monospace for all data/code, and a syntax palette tuned for scanning — not a rainbow.

---

## 1. Color tokens

All color is expressed as CSS custom properties scoped to `[data-theme="light"]` / `[data-theme="dark"]` (see `styles.css`). Never hard-code a hex in a component — reference a token.

### Accent — Pine green

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#1d7a4a` | `#46b87a` | Primary actions (Run), active states, selection, links |
| `--accent-hover` | `#186540` | `#5cc78c` | Hover on accent surfaces |
| `--accent-soft` | `rgba(29,122,74,.10)` | `rgba(70,184,122,.15)` | Active row/tab backgrounds |
| `--accent-soft-strong` | `rgba(29,122,74,.17)` | `rgba(70,184,122,.24)` | Selection highlight, focus ring |
| `--accent-fg` | `#ffffff` | `#ffffff` | Text/icons on an accent fill |

> The accent **brightens in dark mode**. When a custom accent is chosen via Tweaks, `app.jsx` lightens it ~34% for dark so it stays legible on charcoal — light-mode hex is never shown directly on a dark background.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-app` | `#e7e3d8` | `#100f0b` | Window chrome / behind panels |
| `--bg-sidebar` | `#eeebe2` | `#100f0b` | Sidebar, footers |
| `--bg-panel` | `#faf8f2` | `#131210` | Main content surface |
| `--bg-editor` | `#fbf9f3` | `#0f0e0a` | Query editor |
| `--bg-inset` | `#e9e5da` | `#201e17` | Inputs, segmented controls, table headers |
| `--bg-elevated` | `#fcfaf5` | `#201e17` | Modals, menus, popovers |
| `--bg-hover` | `rgba(40,44,28,.05)` | `rgba(255,250,235,.05)` | Row/button hover |
| `--bg-active` | `var(--accent-soft)` | `var(--accent-soft)` | Selected rows |

### Borders & ink rule

| Token | Light | Dark | Use |
|---|---|---|---|
| `--border` | `#e1dccf` | `#2a2820` | Default dividers |
| `--border-soft` | `#ebe6da` | `#211f18` | Subtle/inner dividers |
| `--border-strong` | `#d2cbba` | `#3a372d` | Control outlines |
| `--rule` | `#1e231f` | `#34312a` | **Editorial ink rule** — under the title bar and table headers only |

The **ink rule** is the signature editorial gesture. Use it sparingly: the title bar bottom border and the table header underline. Don't sprinkle thick rules everywhere — that's what made earlier explorations feel heavy.

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--text` | `#1e231f` | `#e9e4d6` | Primary text |
| `--text-2` | `#565c50` | `#a39c8a` | Secondary labels, body |
| `--text-3` | `#6a7062` | `#968f7d` | Tertiary, captions |
| `--text-faint` | `#a6a99c` | `#5b5547` | Disabled, line numbers, placeholders |

### Syntax / data palette

Warm and scan-friendly. Shared names cover both the query editor and result cells.

| Token | Light | Dark | Applies to |
|---|---|---|---|
| `--syn-key` | `#3f463c` | `#cfcab8` | Object keys |
| `--syn-string` | `#5f7a2c` | `#9fc26a` | Strings (olive) |
| `--syn-number` | `#b15a1e` | `#d99a52` | Numbers (rust) |
| `--syn-bool` | `#7c5aa0` | `#b89ad0` | Booleans (plum) |
| `--syn-objectid` | `#9a6a2d` | `#c99a5a` | ObjectId (bronze) |
| `--syn-date` | `#5f7a2c` | `#9fc26a` | ISODate |
| `--syn-fn` | `#1d7a4a` | `#46b87a` | Collection / method calls (pine) |
| `--syn-keyword` | `#b15a1e` | `#d99a52` | `db`, operators |
| `--syn-null` / `--syn-punct` | `#a6a99c` | `#5b5547` | null, punctuation |

---

## 2. Typography

```
--font-ui:   "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

- **Space Grotesk** — all UI chrome: labels, buttons, headings, the wordmark. Its slightly mechanical grotesk character is what makes the tool feel "designed" rather than generic.
- **IBM Plex Mono** — *everything that is data or code*: query editor, result tables, ObjectIds, hostnames, index specs, the database chip.

Mono font is user-swappable via Tweaks (IBM Plex Mono · JetBrains Mono · SF Mono). UI font is fixed.

### Scale & treatment

| Role | Size | Weight | Notes |
|---|---|---|---|
| Modal / empty-state heading | 16–22px | 700 | `letter-spacing: -0.01em` |
| Body / labels | 12.5–13.5px | 500–600 | |
| **Section labels** | 10–11px | 700 | `text-transform: uppercase`, `letter-spacing: .08–.12em` |
| **Table headers** | 11px | 700 | uppercase, `.06em`, ink underline |
| Data / code | 12–13.5px | 400–500 | mono, `line-height ~1.6–1.7` |
| Captions / meta | 10.5–11.5px | 500 | mono, `--text-3` |

Uppercase + letter-spacing on small labels is a core part of the editorial voice. Apply it to structural labels (DATABASES, column headers), never to body copy.

---

## 3. Shape, spacing, elevation

```
--radius:    4px;   /* default — buttons, inputs, rows */
--radius-sm: 3px;   /* dense controls, segmented buttons */
--radius-lg: 8px;   /* modals, the empty-state logo tile */
```

Corners are **sharp-ish** — present but restrained. Pine is not a "pill" UI.

**Density** is a multiplier (`--density`) on row paddings: `compact` = `1`, `comfy` = `1.22`. Compact is the default — this is a tool for people who want a lot of data on screen.

**Spacing** follows a loose 4px rhythm. Common values: row padding `~5–9px × density` vertical / `8–14px` horizontal; panel padding `11–14px`; modal padding `18–20px`.

**Elevation** is warm-tinted and soft — depth, never drama:

```
--shadow-sm  small lift (segmented "on" state, primary button)
--shadow-md  cards, the empty-state logo
--shadow-lg  modals and popovers
```

Shadows use warm-brown rgba in light and deep black in dark. Most surfaces are flat and rely on borders; reserve shadows for things that genuinely float (menus, modals).

---

## 4. Components

### Buttons
- **`.btn.primary`** — pine fill, `--accent-fg` text, subtle green-tinted shadow. The Run button.
- **`.btn`** — neutral: `--bg-elevated` + `--border-strong`, hover lifts to `--bg-hover`.
- **`.btn.ghost`** — transparent until hover. Toolbar actions (Save, Explain, Library).
- **`.icon-btn`** — square 26–30px hit area, transparent → `--bg-hover`. Add `.danger` for destructive (red on hover).

### Connection rows & tree
- Active connection / selected collection: `--bg-active` fill + a **3px accent left bar** (`box-shadow: inset 3px 0 0 var(--accent)` for tree nodes; `.accent-rail` element for connection rows, tinted with the connection's own color).
- Status dots: green `on`, amber `warn`, faint `off`, with a soft ring glow.
- Row actions reveal on hover (`opacity 0 → 1`).

### Segmented control (`.seg`)
- Track is `--bg-inset` + border; the active button gets `--bg-elevated` + `--shadow-sm` in **light**, and a solid **accent fill** in **dark**. (Tree / JSON / Table.)

### Inputs (`.input`)
- `--bg-inset` fill, `--border`; on focus: accent border + `0 0 0 3px var(--accent-soft)` ring and surface lifts to `--bg-panel`.

### Modal (`.modal` / `.overlay`)
- Centered, `--radius-lg`, `--shadow-lg`, blurred dim backdrop. Header / footer separated by `--border-soft`; footer sits on `--bg-sidebar`. Pop-in animation `.16s`.

### Context menu (`.ctx-menu`)
- `--bg-elevated`, `--shadow-lg`, 5px padding, items at `--radius-sm`. Hover-expand submenus (`.ctx-sub`). Right-click a database for Sort ▸ Default / A–Z. Closes on outside-click / Escape, clamps on-screen.

### Result table (`.res-table`)
- Sticky uppercase headers with the ink underline; sticky index column; hover row tint via `--row-stripe`; mono cells colored by the syntax palette.

### Theme switch
- Lives in the **sidebar footer** (bottom-left), not the title bar — it's an app-level preference, kept away from query actions. Sliding sun/moon knob.

---

## 5. Conventions & guardrails

- **Tokens only.** No raw hex in components. New color? Add a token in both themes.
- **One ink rule, used twice.** Title bar + table headers. Don't proliferate heavy rules.
- **Mono = data, Space Grotesk = chrome.** Don't render UI labels in mono or data in the sans.
- **Accent is structural, not decorative.** It marks the primary action and the current selection. Avoid accent-colored text runs, gradients, or large accent fills.
- **Warm, never cold.** If a neutral looks gray-blue, it's wrong — nudge it toward the paper/charcoal warmth.
- **Compact first.** Default to dense layouts; `comfy` is the opt-in.
- **No emoji, no gradients-as-decoration, no rounded "card with left accent bar" tropes.**
- **Light-first.** Design and verify in light, then confirm dark via the toggle. (Dark mode is correct in-app even though the screenshot tool renders the `data-theme` cascade unreliably.)

---

## 6. File map

| File | Role |
|---|---|
| `styles.css` | Design tokens (light + dark), base reset, scrollbars |
| `app.css` | Component & layout styles (frame, sidebar, editor, results, modal, menus) |
| `app.jsx` | App shell, state, theme/accent application, Tweaks panel |
| `icons.jsx` | Inline SVG icon set (1.6 stroke, `currentColor`) |
| `modal.jsx` | New Connection modal |
| `results.jsx` | Tree / JSON / Table result renderers |
| `data.js` | Mock connections, databases, documents, indexes |
| `directions/` | Original aesthetic explorations (A–F) — kept for reference |

