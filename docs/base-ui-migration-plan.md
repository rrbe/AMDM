# Base UI 迁移计划（可直接开工的执行文档）

> **给未来 session 的话：** 这份文档是自包含的。读完即可从 **Phase 0** 开始动手，**无需重新查库、重新选型、重新征求决策**——选型已拍板（见 §2），Base UI API 速查见 §4，现状盘点见 §5。每完成一个切片跑 `pnpm typecheck` 并提交一次（Conventional Commits，中文，直接提到 `master`）。

---

## 1. 这是什么 / 为什么做

精简、性能优先的 MongoDB 桌面 GUI（Electron + React + TS + Vite）。开发中频繁出现**诡异边距 + 表单行为**，根因是 chrome 层全是裸 `<input>/<select>/<label>` + ad-hoc CSS、没有统一表单抽象（`ConnectionForm.tsx` 706 行为最）。

**目标：** 用 headless 组件库 **Base UI** 重建 **chrome 层**（弹窗/下拉/菜单/Tooltip/复选/Tabs/表单），把行为、无障碍、表单校验做正确；视觉用现有 Slate token 上色，**尽量非破坏**。

---

## 2. 已拍板的决策（不要再纠结/推翻）

- **配色已是 Slate**（白底 + 中性浅灰 + 石墨强调），见 `DESIGN.md`、`styles.css` 顶部两块 token。本次迁移**不改配色**。
- **组件库 = `@base-ui/react`**（headless，Radix/Floating UI/MUI 作者团队，7 人全职维护）。
  - ⚠️ **包名陷阱**：装 **`@base-ui/react`**（已到 **1.5.0** 稳定线）。**不要**装 `@base-ui-components/react`（旧名，冻在 `1.0.0-rc.0`，弃用）。
- **样式 = 继续用纯 CSS + Slate token**。Base UI 用 `className` + `data-*` 上色，零运行时。**不上 Tailwind、不上 Mantine、不上 CSS-in-JS。**
- **表单校验用 Base UI `Field`/`Form` 自带**（`validationMode` + `Field.Error match`）。**不引 react-hook-form。**
- **薄封装层**：全 app 只 import `components/ui/*` 自己的封装，**不直接 import Base UI**（隔离它的 API 变动；沿用现有 `common/Button.tsx` 的封装思路）。
- **spacing scale（`--space-*`）本次先不做**，以后单独讨论（修起来很快）。
- **数据展示区尽量不动**（见 §6）——用户明确喜欢现状的字体/虚线/选中样式。实在要动会先确认、之后再调。

**保留的栈（不换）：** React 18 + TS + Vite(electron-vite)、Zustand v5、@tanstack/react-virtual、CodeMirror 6、lucide-react、react-i18next。

---

## 3. 安装与一次性设置（Phase 0）

```bash
pnpm add @base-ui/react        # 纯 JS，无原生构建，不动 package.json#pnpm.onlyBuiltDependencies
```

- 在根容器加 `isolation: isolate`（Base UI 弹层叠放要求）。候选：`styles.css` 里 `#root` 或 `.app`。
- 校准 z-index 层级：菜单/下拉/Tooltip 必须盖过弹窗。现状参考：`.app-tooltip` z=3000、`.modal-backdrop`/`.ctx-menu` z=1000、`.url-popup-backdrop` z=1100。Base UI 弹层走 `Portal` 到 `<body>`，给它们的 Popup/Positioner 容器配套 z-index。
- 跑 `pnpm typecheck` 确认装好。
- （iOS Safari 的 `position: relative` 设置与桌面 Electron 无关，忽略。）

---

## 4. Base UI API 速查（已核实，免去再查文档）

**导入：** `import { Dialog } from '@base-ui/react/dialog'`（子路径 = 组件名小写）。

**上色方式（所有组件通用）：**
- `className` 可传字符串，或传 `(state) => string` 函数（state 含 `disabled/open/selected/...`）。
- 用 `data-*` 属性做 CSS 选择器：
  - 通用：`data-disabled`、`data-open` / `data-closed`、`data-side`（top/bottom/left/right）。
  - 动画：`data-starting-style`、`data-ending-style`。
  - Select 项：`data-highlighted`（键盘/hover 高亮）、`data-selected`。
  - Field：`data-invalid` / `data-valid` / `data-touched` / `data-dirty` / `data-focused` / `data-filled`。

### Dialog（→ 替换 `common/Modal.tsx` 内部）
```
Dialog.Root(open, onOpenChange) > Dialog.Portal > Dialog.Backdrop
  + Dialog.Popup > Dialog.Title / Dialog.Description / Dialog.Close
```
- 受控：`<Dialog.Root open={open} onOpenChange={setOpen}>`。我们的弹窗都由外部 state 控制，**不需要 `Dialog.Trigger`**（直接受控 open）。
- 关闭：`Dialog.Close` 或外部把 open 设 false；Esc / 点遮罩默认会触发 `onOpenChange(false)`。
- 动画态：`data-open/closed` + `data-starting-style/ending-style`。

### Select（→ 替换原生 `<select>`）
```
Select.Root(items, value, onValueChange, multiple?) > Select.Trigger > Select.Value(placeholder) + Select.Icon
  > Select.Portal > Select.Positioner > Select.Popup > Select.List
      > Select.Item(value) > Select.ItemIndicator + Select.ItemText
```
- 受控：`value` + `onValueChange`；`items={[{label,value}]}` 让 Trigger 自动显示选中项的 label。
- 上色：Trigger 仿现有 `input`/`select`（`--bg-2` + border + 聚焦环）；Popup 仿 `.ctx-menu`；Item `[data-highlighted]` → `--bg-3`。

### Field / Input / NumberField（→ 重建表单）
```
Field.Root(validationMode, validate?) > Field.Label > Field.Control(或 <Input>) 
  > Field.Description > Field.Error(match="valueMissing" | true)
```
- `validationMode`: `onSubmit`(默认) / `onBlur` / `onChange`。
- `Field.Error match=` 按 `ValidityState`（如 `valueMissing`、`patternMismatch`）或 `true` 常显。
- 自定义校验：`validate` 函数返回错误串或 `null`。
- 上色：复用现有 `.form-row` / `label` / `input` / `.hint`；错误文字用 `--err`。

### 其它（用到时按同样模式查 base-ui.com/react/components/<name>）
`Checkbox`（Root + Indicator）、`Menu`（Root/Trigger/Portal/Positioner/Popup/Item/Separator）、`Tooltip`、`Tabs`（Tabs/List/Tab/Panel）、`Switch`、`Toast`、`Combobox`/`Autocomplete`（Radix 没有，Base UI 有）。

---

## 5. 现状盘点（迁移目标清单，行号以当前 master 为准，改动前请复查）

### `common/Modal.tsx` —— 保持对外 API 不变，只换内部实现
当前 props：`{ title, onClose, children, footer?, small? }`，类名 `.modal-backdrop / .modal(.small) / .modal-header / .modal-body / .modal-footer`，已处理 Esc + 点遮罩关闭。
**消费方（6 个，迁移后应零改动）：** `settings/SettingsModal.tsx`、`sidebar/ConnectionForm.tsx`、`io/ExportModal.tsx`、`io/ImportModal.tsx`、`shell/SaveQueryModal.tsx`、`results/DocEditor.tsx`。
→ **策略：** 把 `Modal` 内部改成 Base UI `Dialog`（受控 open = 挂载即开），**props 签名不变**，6 个消费方自动受益。`DocEditor` 的编辑区正文（textarea）属于数据区，**不动**，只换它的弹窗外壳。

### 原生 `<select>`（8 处）→ `ui/Select`
- `sidebar/ConnectionForm.tsx`: L422(authType)、L459、L507
- `settings/SettingsModal.tsx`: L40、L53、L68、L116
- `shell/ShellWorkspace.tsx`: L53（工作区选库 db-select）

### checkbox → `ui/Checkbox`
`sidebar/ConnectionForm.tsx`、`settings/SettingsModal.tsx`、`io/ExportModal.tsx`（`url-popup-check` 也算）。

### 菜单 / Tooltip / Toast（app 级自定义）
- `components/ContextMenu.tsx`（`.ctx-*` 类）→ `ui/Menu`。消费方：右键目录树/结果区。
- `components/common/TooltipLayer.tsx`（`.app-tooltip`，portaled）→ `ui/Tooltip`。**风险/收益低，放最后；不顺手可暂留现状。**
- `components/common/Toaster.tsx` + `Toast.tsx` → `ui/Toast`。**同上，放最后。**

### `ConnectionForm.tsx`（706 行，最大块，放后期）
- Tab 状态 L47 `useState<Tab>('general')`，UI 在 L326 `.tabs` → `ui/Tabs`。
- url-popup（From URL / To URL）：L609 / L651，`.url-popup-backdrop` / `.url-popup`，自带遮罩 → 可改成 Base UI `Dialog`。
- 3 个 select + 若干 checkbox + 大量 `.form-row` → `ui/Field`/`Input`/`Select`/`Checkbox`。

---

## 6. 保留不动（数据展示区——除非先确认，否则别碰）

`results/TreeView.tsx`、`results/TableView.tsx`、`results/JsonView.tsx`、`results/ResultPanel.tsx`、`results/ExplainView.tsx`、`results/CellInput.tsx`、`shell/ShellEditor.tsx`、虚拟滚动容器、`explorer/Explorer.tsx` 的目录树行渲染。
**要保住的视觉：** 等宽字体、`1px dashed var(--border)` 虚线网格、选中样式 `--accent-soft-strong` + `.tbl-td.selected` 的 `inset` 描边、KEY|VALUE|TYPE 三列、类型着色（`--t-*`）。这些都是纯 CSS，迁移 chrome 不应触及。

---

## 7. 封装层设计 `components/ui/*`（Phase 1 产出）

每个文件 = Base UI 原语 + 现有 CSS class/token 上色 + 我们自己的精简 props：

| 文件 | 基于 | 复用的现有 CSS | 说明 |
|---|---|---|---|
| `ui/Dialog.tsx` | Dialog | `.modal*` | 给 `common/Modal.tsx` 当底；受控 open |
| `ui/Select.tsx` | Select | 仿 `input` + `.ctx-menu`/`.ctx-item` | props: `value/onChange/options/placeholder` |
| `ui/Field.tsx` | Field | `.form-row`/`label`/`.hint` | label+control+hint+error 一体 |
| `ui/Input.tsx` | Field.Control/Input | `input` | 配合 Field |
| `ui/NumberField.tsx` | NumberField | `input` | 每页条数、字号等数值项 |
| `ui/Checkbox.tsx` | Checkbox | `input[type=checkbox]` 观感 | |
| `ui/Menu.tsx` | Menu | `.ctx-*` | 给 ContextMenu 当底 |
| `ui/Tooltip.tsx` | Tooltip | `.app-tooltip` | 放后期 |
| `ui/Tabs.tsx` | Tabs | `.tabs` + `button.active` | 给 ConnectionForm 用 |

---

## 8. 分阶段执行

- **Phase 0 · 基线+安装**：(本仓 Slate 已提交 `2a8bca6`) → `pnpm add @base-ui/react` → 加 `isolation: isolate` → typecheck。
- **Phase 1 · 封装层**：建 §7 各 `ui/*`，逐个 typecheck。先做 `Dialog`/`Select`/`Field`+`Input`/`Checkbox`，再 `Menu`/`Tabs`，最后 `Tooltip`/`Toast`。
- **Phase 2 · 迁移消费方（切片，先样板后铺开）**
  1. `common/Modal.tsx` 内部换 `ui/Dialog`（API 不变）→ 6 弹窗受益。**第一个样板，务必先 `pnpm dev` 肉眼比对。**
  2. 8 处 `<select>` → `ui/Select`。
  3. 小表单先行：`SettingsModal`、`SaveQueryModal` → `ui/Field/Input/Checkbox/Select`。
  4. `ContextMenu` → `ui/Menu`。
  5. `ConnectionForm`（含 `.tabs`→`ui/Tabs`、url-popup→`ui/Dialog`、selects/checkbox/form-row）。
  6. （可选，末尾）`TooltipLayer`→`ui/Tooltip`、`Toaster`→`ui/Toast`。
- **Phase 3 · 收尾**：删被替换的死 CSS/代码；给 `DESIGN.md` 加"§ UI 组件（Base UI 封装层 + data-* 上色约定）"；跑 `pnpm test:unit`。

---

## 9. 校验闸门 & 提交策略

- **每步**：`pnpm typecheck`（先 node 后 web，唯一硬闸门）。
- **每切片**：`pnpm dev` 肉眼比对观感（尤其 Phase 2.1 样板）。
- **收尾**：`pnpm test:unit`（CI 闸门，unit+contract）。数据视图无关测试不应受影响。
- **提交**：每完成一个切片提交一次，直接到 `master`，Conventional Commits + 中文，例如：
  `feat: 接入 @base-ui/react 与 components/ui 封装层` →
  `refactor: 弹窗统一到 Base UI Dialog（Modal 内部重写，API 不变）` →
  `refactor: 原生 select 迁移到 ui/Select` →
  `refactor: 连接表单迁移到 Base UI Field/Tabs` …

---

## 10. 风险与对策

- **Base UI 年轻（1.5）** → 封装层隔离 API；`package.json` 锁精确版本。
- **观感漂移** → 复用现有 class/token；side-by-side 比对；数据视图零改动。
- **弹层定位/层级**（Floating UI portal） → `isolation: isolate` + 校准 z-index（见 §3）。
- **i18n** → 文案走现有 `react-i18next` key，别硬编码（见 `src/renderer/src/i18n`，三语齐全性有单测）。
- **Zustand v5 稳定引用坑** → 表单/弹窗若读 store，selector 必须返回稳定引用（见 `CLAUDE.md`）。

---

## 11. 相关文档

`DESIGN.md`（Slate 设计系统 + token/class 词汇）、`SPEC.md`（范围）、`CONTEXT.md`（术语）、`docs/adr/0004`（性能铁律——虚拟化、重活下沉，迁移不得违反）、`CLAUDE.md`（协作规则、进程架构、IPC 接缝）。
