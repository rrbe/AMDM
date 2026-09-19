# Changelog

[中文](CHANGELOG_CN.md)

<!-- Generated from published release tags and translated commit entries. Dates follow the tagged commits. -->

## [v26.9.3](https://github.com/rrbe/AMDM/releases/tag/v26.9.3) — 2026-09-15

### Features

- Adapt tab widths and show result data size and retention notices
- Add interface transitions and inline Explorer search
- Localize changelogs and Sparkle release notes

### Fixes

- Smooth Explorer navigation transitions and preserve focus

## [v26.9.2](https://github.com/rrbe/AMDM/releases/tag/v26.9.2) — 2026-09-13

### Features

- Add automatic nested table display and settings preview
- Generate commit\-based changelog and Sparkle release notes
- Add grouped table headers and display setting
- Preview nested values in table cells
- Support table column drag sorting per query tab
- Add confirmed collection deletion
- Show relative query times in tab tooltips
- Support drag sorting for query and result tabs

### Fixes

- Preserve historical Sparkle archive release URLs
- Isolate result view per data tab
- Close query tab before closing window
- Move context toggle to top tab bar
- Improve glass menu readability

### Other Updates

- Add AMDM screenshots to bilingual readmes

## [v26.9.1](https://github.com/rrbe/AMDM/releases/tag/v26.9.1) — 2026-09-11

### Features

- Add selectable mongosh query runtime
- Add cross\-platform differential updates

### Fixes

- Clarify disconnected tabs and align view switch corners

### Other Updates

- Update TODO
- Refine context menu glass effect

## [v26.8.17](https://github.com/rrbe/AMDM/releases/tag/v26.8.17) — 2026-08-31

### Features

- Expand document transfer formats

### Fixes

- Refine JSON format menus
- Clarify result copy menu
- Copy focused table cell with shortcut

## [v26.8.16](https://github.com/rrbe/AMDM/releases/tag/v26.8.16) — 2026-08-24

### Features

- Reveal contextual tab shortcuts
- Centralize app notifications
- Classify connection and query failures
- Configure export destination
- Open exported files from success notice

### Fixes

- Keep result views scoped to query tabs
- Show exact query context in tab tooltips
- Improve automatic update checks
- Allow disconnecting errored connections

### Other Updates

- Update readme usage and license
- Adopt gpl\-3\.0\-only license

## [v26.8.15](https://github.com/rrbe/AMDM/releases/tag/v26.8.15) — 2026-08-18

### Features

- Add document preview actions
- Refine tooltips and query controls

### Fixes

- Refresh and highlight available updates

### Other Updates

- Refine tooltip appearance and placement

## [v26.8.14](https://github.com/rrbe/AMDM/releases/tag/v26.8.14) — 2026-08-17

### Fixes

- Remove checkbox focus rings

### Other Updates

- Refine button and checkbox treatments
- Refine query search and focus styles
- Simplify query context menu

## [v26.8.13](https://github.com/rrbe/AMDM/releases/tag/v26.8.13) — 2026-08-15

### Features

- Add table result sorting \(\#21\)
- Highlight saved query previews \(\#20\)
- Add contextual query run gutter \(\#19\)
- Add indexes refresh action

### Fixes

- Avoid catalog loading flicker

## [v26.8.12](https://github.com/rrbe/AMDM/releases/tag/v26.8.12) — 2026-08-14

### Features

- Add unified collection and result exports
- Add configurable keyboard shortcuts

### Fixes

- Upgrade electron and security dependencies

### Other Updates

- Upgrade application dependencies
- Reorganize engineering documentation

## [v26.8.11](https://github.com/rrbe/AMDM/releases/tag/v26.8.11) — 2026-08-13

### Features

- Add gentle update reminders

### Fixes

- Show scheduled update prompt

## [v26.8.10](https://github.com/rrbe/AMDM/releases/tag/v26.8.10) — 2026-08-13

### Features

- Inspect and copy collection indexes
- Refresh collection metadata
- Show query timestamps

### Fixes

- Preserve query tabs across connection loss

## [v26.8.9](https://github.com/rrbe/AMDM/releases/tag/v26.8.9) — 2026-08-11

### Features

- Add data font size setting
- Add customizable editor color schemes

### Fixes

- Bring settings window to front

## [v26.8.8](https://github.com/rrbe/AMDM/releases/tag/v26.8.8) — 2026-08-10

### Features

- Add schema analysis and modeling
- Add nested result context menus

### Fixes

- Make feedback text copyable
- Watch electron process during development

## [v26.8.7](https://github.com/rrbe/AMDM/releases/tag/v26.8.7) — 2026-08-09

### Features

- Enhance shell editor completion
- Refine explorer and history settings
- Add query timeout and reliable stopping
- Show catalog statistics

### Fixes

- Disable selection match highlighting
- Stop app before mac install

## [v26.8.6](https://github.com/rrbe/AMDM/releases/tag/v26.8.6) — 2026-08-07

### Features

- Persist connection ordering

### Fixes

- Remove modal backdrop blur
- Require context menu for cell editing
- Move users after collections

### Other Updates

- Reuse resizable modal
- Streamline package scripts

## [v26.8.5](https://github.com/rrbe/AMDM/releases/tag/v26.8.5) — 2026-08-07

### Features

- Improve result field browsing
- Color tabs by connection
- Apply neutral ui design system
- Improve connection options
- Improve connection settings form interactions
- Refactor the settings window and improve version labels

### Fixes

- Refine explorer actions
- Improve connection feedback and catalog refresh
- Support MongoDB connection URLs with multiple members

### Other Updates

- Define neutral ui design direction
- Fix pack bug
- Simplify project documentation

## [v26.8.4](https://github.com/rrbe/AMDM/releases/tag/v26.8.4) — 2026-08-03

### Features

- Add Sparkle automatic updates
- Improve result toolbar interactions
- Redesign sidebar navigation and query switching
- Run the default query when a collection is first opened
- Show execution status on query tabs
- Adjust the build version format
- Redesign the three\-pane application layout
- Reduce the default editor height
- Highlight query execution status
- Display the build number
- Redesign the UI with Tailwind v4 and shadcn zinc and blue styling \(\#17\)
- Add SSH host key verification, ProxyJump, per\-hop connectivity checks, and robustness improvements
- Remember and restore native fullscreen state \(\#16\)
- Remember and restore window size and position \(\#15\)
- Improve Mongo shell completion with type awareness, REPL support, sorting, and snippets \(\#12\)
- Refine the sidebar with sticky scrolling, connection context menus, and separate query and history sections \(\#10\)
- Add a visual aggregation pipeline builder \(\#9\)
- Display explain stages as a connected box tree \(\#8\)
- Handle BSON imports and exports in process without mongodump or mongorestore \(\#7\)
- Open collections in separate query tabs without overwriting edited code \(\#5\)
- Support implicit await for pasted mongosh scripts with async\-rewriter2
- Capture Shell print output and add a Console result view
- Open each execution in a new result tab that can be switched or closed
- Add a components/ui wrapper layer based on @base\-ui/react
- Integrate @base\-ui/react and establish an isolation baseline
- Unify the full\-width title bar and complete Command\-C copying in results
- Adopt a neutral Slate palette in place of the Compass green and gray theme
- Separate From URL and To URL connection editing into two dialogs
- Add English, Simplified Chinese, and Traditional Chinese with centralized settings
- Add runtime window and macOS Dock icons
- Add the BSON document application icon
- Add query tabs with independent code, results, and execution
- Export and back up connection settings without secrets
- Organize saved queries into folders with two levels
- Replace native title tooltips with consistent styled tooltips
- Add editor font size, word wrap, and tab width preferences
- Support stopping scripts through the driver&\#39;s AbortSignal
- Add application\-managed row selection and multi\-selection in results
- Add result pagination and configurable page sizes
- Keep button widths stable across states and remove execution hint text
- Add an editor context menu aligned with NoSQLBooster
- Color the Tree type column consistently with values
- Add a Type column showing BSON types in the Tree view
- Show inline validation errors with a red border and hover message
- Support double\-click inline editing and move edit and delete actions to the context menu
- Align copy formats with NoSQLBooster and add CSV and TSV table exports
- Support copying from Tree, JSON, and Table views in three formats
- Include authorized empty databases in the database list
- Allow resizing the sidebar and editor and fix header border alignment
- Expand mongosh syntax support and add real MongoDB integration tests
- Move saved queries into a sidebar drawer and remove the top Library button
- Add an editor formatting shortcut and fix system theme handling
- Add a system\-following theme mode and rename the sidebar title to Mongo Shell GUI
- Align colors and fonts with MongoDB Compass and LeafyGreen
- Add resizable table columns, dashed grid lines, and row numbers starting at 1
- Switch between Tree, JSON, and Table views with Command\-1, Command\-2, and Command\-3
- Add syntax highlighting to JSON results
- Use a two\-column key/value layout in the Tree view
- Use Lucide explorer icons and move import and export actions into context menus
- Retheme UI to light\-first Pine design with dark mode
- Merge connections \+ catalog into one explorer tree
- Initial MVP — lean MongoDB shell GUI

### Fixes

- Complete the Sparkle release flow for ad\-hoc signed builds
- Clarify result copy format labels
- Fix result copying behavior
- Improve window dragging and tooltip behavior
- Keep the user catalog label in English
- Allow cancelling connections while they are being established
- Fix execution of selected Shell code
- Bind tabs to connections \(\#18\)
- Increase the driver timeout to 30 seconds to avoid interrupting slow queries \(\#4\)
- Report errors for async sort comparators and address remaining review issues \(\#2\)
- Support async callbacks in forEach, map, and other driver\-returned array methods \(\#1\)
- Install and inline @babel/preset\-typescript to fix packaged startup crashes
- Inline @mongosh/async\-rewriter2 to fix packaged startup crashes
- Fix Command\-C in the result grid when the editor retains a selection
- Synchronize the @base\-ui/react specifier in pnpm\-lock
- Inline exceljs to fix packaged startup crashes
- Support Intel x64 builds and correct architecture claims in the ADR
- Invoke electron\-builder directly in the release workflow so \-\-publish never takes effect
- Resolve CI pnpm version conflicts using the packageManager field
- Disable macOS autocorrection and spell checking in the editor
- Extract docOps and catalog cores and preserve \_id and numeric types
- Unify extended EJSON type detection and fix empty container rendering
- Focus the result grid on click so Command\-C works after multi\-selection
- Use application\-managed selection instead of native text selection in result grids
- Use opaque semantic toasts to prevent background text showing through
- Show empty database placeholders as disabled gray italics and run admin commands concurrently
- Support ObjectId\(\) without new and cursor\.projection\(\) in Shell scripts

### Performance

- Offload BSON→EJSON serialization and field sampling to a worker

### Other Updates

- Adjust version numbers and build identifiers
- Upgrade TypeScript and Vite
- Simplify the connection and query workspace
- Upgrade to version 0\.5\.0
- Refine dark mode styling
- Keep connection catalog terminology in English
- Delay tooltips and position them to the right
- Simplify layout and shadows
- Remove the separate window title bar
- Clean up build and repository files
- Bump version to 0\.4\.0 \(\#13\)
- Split styles, add a CSS Module template, and organize documentation \(\#11\)
- Upgrade electron\-vite to v5, vite to v7, vitest to v4 \(\#6\)
- Bump version to 0\.3\.1 \(\#3\)
- Use ad\-hoc signing for faster local dist:dir builds
- Document inlining main\-process dependencies to avoid electron\-builder collection omissions
- Expose the store as window\.\_\_appStore in development for debugging
- Highlight active result tabs with an accent border and bold text
- Complete the Base UI migration, remove unused CSS, and update DESIGN\.md
- Migrate connection forms to Base UI Tabs, Field, Input, Select, Checkbox, and Dialog
- Unify context menus with Base UI Menu while preserving the existing API
- Migrate settings and saved\-query forms to Base UI Field, Input, Select, and Checkbox
- Use ui/Select for workspace database selection
- Unify modals with Base UI Dialog while preserving the existing API
- Release v0\.2\.1
- Add an actionable Base UI migration plan
- Upgrade GitHub Actions to current major versions and use Node 22
- Add a tag\-triggered workflow for cross\-platform packaging and GitHub Releases
- Simplify README and add README\_CN in Chinese
- Use title case instead of forced uppercase in UI headings and columns
- Prepare the release license, README, and trademark notice
- Rename the project to AMDM \(Another Mongo Desktop Manager\)
- Add electron\-builder packaging configuration
- Expand contract, unit, and integration test coverage
- Extract selection logic into the pure computeSelection function
- Set up test layers, scripts, coverage, conventions, and CI
- Add a code\-verified TODO\.md roadmap and correct outdated SPEC section 4 items
- Consolidate text action buttons into the Button component
- Remove copy confirmation toasts and the JSON select\-all hint
- Refine side panel spacing, typography, and connection fonts
- Add DESIGN\.md for the Pine design system
- Add CLAUDE\.md with architecture, commands, and collaboration rules
