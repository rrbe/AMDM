# Mongo Shell GUI — Design System

**Codename: Compass.** Modeled directly on MongoDB Compass and its LeafyGreen design language. Light-first — pure white content on light LeafyGreen-gray chrome, dark-navy ink text, MongoDB-green primary — with a navy dark counterpart. The goal is crisp readability for data work: strong plane separation, calm chrome, and color reserved for the things that carry meaning (the green primary action, and the document syntax palette).

Three principles drive every decision:

1. **Pure white content, LeafyGreen gray chrome.** Content surfaces are `#ffffff` in light and dark-navy `#001e2b` in dark; chrome steps down through LeafyGreen grays. No parchment, no yellow cast, no cement-gray mid-tones — content sits on the brightest plane so text and data read sharp.
2. **Editorial structure.** Strong typographic hierarchy, an ink hairline rule under the title bar and table headers, uppercase letter-spaced labels. Sharp-ish corners (4px), flat surfaces, restraint over decoration.
3. **Readability for data work.** Compact density, a true monospace for all data/code, and a syntax palette tuned for scanning — not a rainbow.

---

## 1. Color tokens

All color is expressed as CSS custom properties scoped to `[data-theme="light"]` / `[data-theme="dark"]` (see `styles.css`). Never hard-code a hex in a component — reference a token.

### Accent — MongoDB green

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#00684a` | `#00ed64` | Primary actions (Run), active states, selection, links |
| `--accent-hover` | `#004d37` | `#00c257` | Hover on accent surfaces |
| `--accent-soft` | `rgba(0,104,74,.08)` | `rgba(0,237,100,.15)` | Active row/tab backgrounds |
| `--accent-soft-strong` | `rgba(0,104,74,.16)` | `rgba(0,237,100,.26)` | Selection highlight, focus ring |
| `--accent-fg` | `#ffffff` | `#001e2b` | Text/icons on an accent fill |

> Light uses LeafyGreen's deep `green.dark2` (`#00684a`, the Compass "Find" button) with **white** text. Dark flips to the bright `green.base` (`#00ed64`) with **dark-navy** text — that's why `--accent-fg` itself changes per theme. When a custom accent is chosen via Tweaks, `app.jsx` lightens it ~34% for dark so it stays legible on navy.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-app` | `#f2f4f5` | `#00141d` | Window chrome / behind panels |
| `--bg-sidebar` | `#f9fbfa` | `#0c2330` | Sidebar, footers |
| `--bg-panel` | `#ffffff` | `#001e2b` | Main content surface |
| `--bg-editor` | `#ffffff` | `#001a26` | Query editor |
| `--bg-inset` | `#e8edeb` | `#112733` | Inputs, segmented controls, table headers |
| `--bg-elevated` | `#ffffff` | `#112733` | Modals, menus, popovers |
| `--bg-hover` | `#e1e7e5` | `#1c2d38` | Row/button hover |
| `--bg-active` | `var(--accent-soft)` | `var(--accent-soft)` | Selected rows |

> Light **content** is intentionally pure `#ffffff` (Compass-style): the brightest plane gives data the most contrast. Chrome (app frame, sidebar, header, inset) steps down through LeafyGreen grays (`gray.light3 → light2`) so panels separate cleanly. Dark is LeafyGreen navy — `black (#001e2b)` content on `gray.dark4/dark3` chrome — never neutral gray or brown.

### Borders & ink rule

| Token | Light | Dark | Use |
|---|---|---|---|
| `--border` | `#e8edeb` | `#1c2d38` | Default dividers (gray.light2 / gray.dark3) |
| `--border-soft` | `#eef1f0` | `#16242f` | Subtle/inner dividers |
| `--border-strong` | `#c1c7c6` | `#3d4f58` | Control outlines (gray.light1 / gray.dark2) |
| `--rule` | `#c1c7c6` | `#3d4f58` | Hairline under the title bar and table headers |

Compass is **airy** — dividers are light hairlines, not heavy ink bars. The `--rule` is just a touch stronger than `--border` to define the title-bar bottom and the table-header underline; the active gesture that carries hierarchy is the **green** tab/selection accent, not a black rule.

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--text` | `#001e2b` | `#e8edeb` | Primary text (LeafyGreen `black` / `gray.light2`) |
| `--text-2` | `#3d4f58` | `#c1c7c6` | Secondary labels, body |
| `--text-3` | `#5c6c75` | `#889397` | Tertiary, captions |
| `--text-faint` | `#889397` | `#5c6c75` | Disabled, line numbers, placeholders |

### Syntax / data palette

Lifted straight from the Compass document view. Shared names cover both the query editor and result cells.

| Token | Light | Dark | Applies to |
|---|---|---|---|
| `--syn-key` | `#001e2b` | `#e8edeb` | Object keys (dark-navy ink, bold) |
| `--syn-string` | `#12824d` | `#35de7e` | Strings (green) |
| `--syn-number` | `#1254b7` | `#6ca8ff` | Numbers (blue) |
| `--syn-bool` | `#883ea8` | `#c39bf3` | Booleans (purple) |
| `--syn-objectid` | `#c2371a` | `#ff6f4d` | ObjectId (coral-red) |
| `--syn-date` | `#1254b7` | `#6ca8ff` | ISODate (blue, like numbers) |
| `--syn-fn` | `#00684a` | `#00ed64` | Collection / method calls (green) |
| `--syn-keyword` | `#883ea8` | `#c39bf3` | `db`, operators (purple) |
| `--syn-null` / `--syn-punct` | `#889397` | `#889397` | null, punctuation (gray) |

> This is the recognizable Compass document coloring: **navy bold keys, green strings, blue numbers/dates, coral-red ObjectId, purple booleans, gray null.** The query editor (CodeMirror) reuses the same assignments, with method calls (`db.coll.find`) in MongoDB green.

---

## 2. Typography

Matched to MongoDB Compass / LeafyGreen.

```
--font-ui:   'Euclid Circular A', 'Helvetica Neue', Helvetica, Arial, sans-serif;
--font-mono: 'Source Code Pro', ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
```

- **Euclid Circular A** — LeafyGreen's UI typeface for all chrome (labels, buttons, headings, the wordmark). It's **proprietary and cannot be bundled**, so the stack falls back to **Helvetica Neue** (macOS) — exactly what Compass renders for anyone without the licensed font. No UI webfont ships with the app.
- **Source Code Pro** — Compass's data/code typeface: *everything that is data or code* (query editor, result tables, ObjectIds, hostnames, index specs, the database chip). Bundled offline via `@fontsource` because the renderer CSP forbids remote font CDNs.

> If a cross-platform, bundled UI font is ever wanted (e.g. for non-macOS), Inter is the closest free stand-in — but on this macOS-first build the Helvetica Neue fallback is the more faithful Compass match.

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

Corners are **sharp-ish** — present but restrained. Compass is not a "pill" UI.

**Density** is a multiplier (`--density`) on row paddings: `compact` = `1`, `comfy` = `1.22`. Compact is the default — this is a tool for people who want a lot of data on screen.

**Spacing** follows a loose 4px rhythm. Common values: row padding `~5–9px × density` vertical / `8–14px` horizontal; panel padding `11–14px`; modal padding `18–20px`.

**Elevation** is neutral and soft — depth, never drama:

```
--shadow-sm  small lift (segmented "on" state, primary button)
--shadow-md  cards, the empty-state logo
--shadow-lg  modals and popovers
```

Shadows use a navy-tinted rgba in light and deep black in dark. Most surfaces are flat and rely on borders; reserve shadows for things that genuinely float (menus, modals).

---

## 4. Components

### Buttons
- **Component: `<Button>`** (`common/Button.tsx`) is the standard **text action** button — toolbar actions and dialog footers. A thin typed wrapper over `<button>` + the classes below: `variant` = `default | primary | ghost | danger`, plus `busy` (spinner) and any native button prop. The CSS stays the single source of visual truth; the component just consolidates the variant API and the busy state. Compose extras via `className` (e.g. `variant="ghost" className="danger"`).
  - **Not** for icon-only buttons (`.icon-btn`), segmented toggles (`.seg` / `.active` / `.selected`), or context-menu items — those are distinct patterns and stay as raw `<button>`.
- **`.primary`** — MongoDB-green fill, white text, subtle green-tinted shadow. The Run button.
- neutral (no variant) — `--bg-2` + `--border`, hover lifts to `--bg-3`.
- **`.ghost`** — transparent until hover. Toolbar actions (Save, Explain, Library).
- **`.icon-btn`** — square 26–30px hit area, transparent → `--bg-hover`. Add `.danger` for destructive (red on hover).
- **Stable width across states.** A button's label is fixed — it must **not** change between idle and in-flight (no `Run → Running…`, `Save → Saving…`). A text swap changes the button's width, which nudges neighbours and reads as a flicker. Show progress with a *state*, not new text: `<Button busy>` keeps the label in flow but invisible and overlays a centered spinner (`.busy-btn` + `.busy-btn-spinner`, `currentColor` so it adapts per variant), auto-disabling while busy. Use it for any action that runs async (Run, Save, Test connection, Import/Export, edit-doc Save). A genuine *semantic* change after completion (e.g. Cancel → Close once an import succeeds) is fine — that's a one-time meaning change, not transient click feedback.

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
- **Mono = data, the UI sans = chrome.** Don't render UI labels in mono or data in the sans.
- **Accent is structural, not decorative.** It marks the primary action and the current selection. Avoid accent-colored text runs, gradients, or large accent fills.
- **Clean, never warm.** If a neutral looks beige or yellow, it's wrong — keep surfaces pure-white (light) / LeafyGreen-navy (dark). Content lives on the brightest plane.
- **Compact first.** Default to dense layouts; `comfy` is the opt-in.
- **No layout shift from feedback.** Controls keep their size while acting — never communicate a click/in-flight/hover state by changing text, font-weight, or padding that resizes the element. Use color, a spinner overlay, or disabled state instead. (Buttons: use `BusyButton`.)
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

