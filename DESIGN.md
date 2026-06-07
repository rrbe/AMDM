# AMDM — 设计系统

**代号：Slate（石墨）。** 一套克制、中性、专业的数据库工具外观，对齐 TablePlus / Navicat / TinyRDM 的路线。亮色优先——纯白内容区坐落在**无色调倾向**的中性浅灰 chrome 上，近黑中性墨色文字，单一**石墨强调色**（仅用于主操作、当前选中、焦点环）；并有一套同样中性的暗色。目标是数据工作的清晰可读：层面分明、chrome 安静、颜色只留给真正承载意义的东西（主按钮 + 文档语法着色）。

> 本主题刻意**弃用**了旧版 Compass 那套带绿调的"灰色水泥"中间灰。换肤是纯 token 级别的——见 §6 与 CLAUDE.md「跨文件关键机制」。

三条原则贯穿每个决策：

1. **纯白内容，中性灰 chrome。** 内容面在亮色是 `#ffffff`、暗色是中性深灰 `#1c1c1f`；chrome（窗口框、侧栏、表头、凸起控件）逐级降到中性灰。**无任何色调倾向**——不偏绿、不偏蓝、不偏暖，内容永远待在最亮的层面，文字与数据读起来最锐利。
2. **结构化排版。** 靠字重、颜色、细发丝线（标题栏与表头下方）建立层级，而非粗黑分隔条。圆角偏锐（5px），表面扁平，克制优先于装饰。
3. **为数据工作而读。** 紧凑密度，所有数据/代码用真正的等宽字体，语法着色为「扫读」调校——不是彩虹。

---

## 1. 颜色 token

所有颜色都是 CSS 自定义属性，定义在 `styles.css` 的 `:root`（亮，默认）与 `[data-theme='dark']`（暗）。**组件里绝不硬编码 hex——一律引用 token。** 暗色块只重指向调色板，所以切回亮色会自然落回 `:root`。

### 强调色 — 石墨

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--accent` | `#3f4754` | `#aeb7c6` | 主操作（Run）、激活态、选中、链接 |
| `--accent-hover` | `#2c333d` | `#9aa4b6` | 强调面 hover |
| `--accent-soft` | `rgba(63,71,84,.10)` | `rgba(174,183,198,.14)` | 激活行/标签背景 |
| `--accent-soft-strong` | `rgba(63,71,84,.16)` | `rgba(174,183,198,.24)` | 选中高亮、焦点环 |
| `--accent-fg` | `#ffffff` | `#1b1d22` | 强调填充上的文字/图标 |

> 亮色用深石墨 `#3f4754` + **白字**；暗色翻为浅石墨 `#aeb7c6` + **深字**（所以 `--accent-fg` 本身随主题变）。石墨是最克制的一档：选中/主按钮/焦点环之外几乎不出现彩色，整体近单色。

### 表面（Surfaces）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--bg-app` | `#ececee` | `#161618` | 窗口 chrome / 面板背后 |
| `--bg-0` | `#ffffff` | `#1c1c1f` | 主内容面（工作区、列表、结果） |
| `--bg-1` | `#f6f6f8` | `#232327` | 侧栏、头部 chrome、底栏 |
| `--bg-2` | `#eeeef1` | `#2a2a2f` | 凸起/内凹（输入框、表头、分段控件） |
| `--bg-3` | `#e6e6ea` | `#34343b` | 行/按钮 hover |
| `--bg-elevated` | `#ffffff` | `#2a2a2f` | 弹窗、菜单、激活分段 |
| `--bg-sel` | `rgba(63,71,84,.10)` | `rgba(174,183,198,.16)` | 选中行底色 |
| `--bg-editor` | `#ffffff` | `#19191c` | 查询编辑器（另见 §6） |

> 亮色**内容**刻意纯 `#ffffff`：最亮层面给数据最高对比；chrome 逐级降到中性灰把面板干净分开。暗色是中性深灰 `#1c1c1f` 内容坐在 `#232327/#2a2a2f` chrome 上——**绝不带蓝/绿/棕调**。

### 边框与发丝线

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--border` | `#e6e6ea` | `#303036` | 默认分隔线 |
| `--border-strong` | `#cfcfd6` | `#45454d` | 控件描边 |
| `--rule` | `#d6d6dc` | `#3a3a42` | 标题栏与表头下方的发丝线（比 `--border` 略重） |

Slate 是**通透**的——分隔用浅发丝线而非粗黑条。`--rule` 只比 `--border` 略强，用来界定标题栏底边与表头下划线；真正承载层级的手势是石墨的选中/激活强调，而不是黑线。

### 文字

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--fg-0` | `#1d1d20` | `#ececee` | 主文字（近黑中性，无色调） |
| `--fg-1` | `#3a3a40` | `#c4c4cb` | 次级标签、正文 |
| `--fg-2` | `#6a6a73` | `#9a9aa3` | 三级、说明 |
| `--fg-3` | `#9a9aa3` | `#6c6c75` | 禁用、行号、占位、计数 |

### 状态色

| Token | Light | Dark |
|---|---|---|
| `--ok` | `#1a8f4c` | `#3ec98a` |
| `--warn` | `#b5701a` | `#e0a23a` |
| `--err` | `#d23b3b` | `#ff6f5c` |
| `--err-bg` | `rgba(210,59,59,.08)` | `rgba(255,111,92,.13)` |

### 语法 / 数据着色（`--t-*`）

查询编辑器与结果单元格共用同一套类型色。**新增任何 BSON 类型，都要同时改这里、`lib/ejson.ts` 与序列化 core**（见 CLAUDE.md）。

| Token | Light | Dark | 应用于 |
|---|---|---|---|
| `--t-key` | `#1d1d20` | `#ececee` | 对象键（近黑墨，与正文同色） |
| `--t-string` | `#1a8f4c` | `#5fd39a` | 字符串（绿） |
| `--t-number` | `#2563eb` | `#74a8ff` | 数字（蓝） |
| `--t-date` | `#2563eb` | `#74a8ff` | ISODate / Timestamp（蓝，同数字） |
| `--t-boolean` | `#8a3fd0` | `#c79bff` | 布尔（紫） |
| `--t-objectId` | `#c0481f` | `#ff8a5c` | ObjectId（橙红） |
| `--t-binary` | `#c0481f` | `#ff8a5c` | BinData / UUID（橙红） |
| `--t-regex` | `#8a3fd0` | `#c79bff` | 正则（紫） |
| `--t-special` | `#c0481f` | `#ff8a5c` | MinKey/MaxKey/Code/DBRef 等 |
| `--t-null` | `#9a9aa3` | `#6c6c75` | null / undefined（灰） |

> 即便强调色是单色石墨，数据着色仍保留可辨识的语义彩：**近黑键、绿字符串、蓝数字/日期、橙红 ObjectId、紫布尔、灰 null**。编辑器（CodeMirror）复用同一套指派，方法调用 `db.coll.find` 走近黑墨（克制，不抢色）。

### 阴影与光晕

`--shadow-sm/md/lg` 为**中性**（纯黑 rgba，无色调）：小浮起（分段激活态、主按钮）/ 卡片 / 弹窗与浮层。多数表面是扁平的、靠边框定义；阴影只留给真正悬浮的东西（菜单、弹窗）。`--halo-ok/warn/err` 是状态点的柔光圈（按需使用，默认克制）。

---

## 2. 排版

```
--font-ui:   'Euclid Circular A', 'Helvetica Neue', Helvetica, Arial, sans-serif;
--font-mono: 'Source Code Pro', ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
--fs:    12px;   /* 基准 */
--fs-sm: 11px;   /* 小号：说明、计数、表头 */
```

- **UI sans** — 所有 chrome（标签、按钮、标题、连接名）。Euclid Circular A 为专有字体不内置，macOS 回退 Helvetica Neue。
- **Source Code Pro** — *所有数据与代码*（编辑器、结果表、ObjectId、host、索引规格、库名 chip）。侧栏连接名也走等宽。

### 字号与处理

| 角色 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 弹窗 / 空状态标题 | 16–22px | 700 | `letter-spacing: -0.01em` |
| 正文 / 标签 | 12–13px | 500–600 | |
| 区块标签（Connections 等） | 11px | 700 | 大驼峰，**不全大写**，`letter-spacing ~.01em` |
| 表头 | 11px | 700 | 大驼峰，发丝线下划线，**不全大写** |
| 数据 / 代码 | 11–12px | 400–500 | mono |
| 说明 / meta | 11px | 500 | mono，`--fg-2/3` |

> **不使用纯英文大写**（`text-transform: uppercase` 已从全站清除，见 SPEC.md 多语言条目）。层级靠字重 + 颜色 + 细微字距，标签一律**大驼峰**（遵循全局与本项目 CLAUDE.md 的命名规则）。

---

## 3. 形状、间距、层级

```
--radius:    5px;   /* 默认 — 按钮、输入、行、分段轨道 */
--radius-sm: 4px;   /* 密集控件、分段按钮、菜单项 */
--radius-lg: 9px;   /* 弹窗 */
--row-h:     24px;  /* 目录树 / 结果行高 */
```

圆角**偏锐**——存在但克制，不是 pill UI。

- **密度**：紧凑优先（这是给想在一屏看大量数据的人用的工具）。行内边距大致 `4–8px` 纵向 / `7–12px` 横向；面板 `6–14px`；弹窗 `12–18px`，遵循松散的 4px 节奏。
- **可拖拽尺寸**：`--sidebar-width`（默认 300px）与 `--editor-height`（默认 160px）由 JS 从持久化设置覆写；拖拽分隔条见 `.resize-handle`。

---

## 4. 组件

### 按钮（Buttons）
- **组件 `<Button>`**（`common/Button.tsx`）是标准**文字操作**按钮——工具栏与弹窗页脚。它是 `<button>` + 下列 class 的薄类型封装：`variant = default | primary | ghost | danger`，外加 `busy`（spinner）。**CSS 是视觉唯一真相**，组件只统一变体 API 与忙碌态。
  - **不**用于纯图标按钮、分段切换（`.view-switch`）、右键菜单项——那些是独立模式，保持原生 `<button>`。
- **`.primary`** — 石墨填充、`--accent-fg` 文字、极淡中性阴影。即 Run 按钮。
- **neutral**（无变体）— `--bg-elevated` + `--border`，hover 升到 `--bg-3`。
- **`.ghost`** — 透明直到 hover。工具栏动作（Save、Explain、Library）。
- **`.danger`** — 危险操作，默认静默、hover 转 `--err` 红。
- **跨状态等宽。** 标签固定，**不得**在 idle 与 in-flight 间变文案（不要 `Run → Running…`）。文案变化会改变按钮宽度、挤动邻居、读作闪烁。用*状态*而非新文案表达进度：`<Button busy>` 让标签留在流内但隐形、叠一个居中 spinner（`.busy-btn` + `.busy-btn-spinner`，`currentColor` 自适应变体），忙碌时自动禁用。任何异步动作都用它（Run、Save、Test、Import/Export、文档保存）。完成后的*语义*变化（如导入成功后 Cancel → Close）可以——那是一次性含义变化，不是瞬时点击反馈。

### 连接行 & 目录树
- 激活连接 / 选中集合：`--bg-sel` 底色；连接行激活态另加 `inset 0 0 0 1px var(--accent-soft-strong)` 描边。
- 状态点：`--ok` 连接、`--err` 错误、断开为细空心环（`.conn-dot-off`）。
- 行内动作 hover 时显现（`opacity 0 → 1`）。
- 展开箭头 `.twisty-icon` 开合旋转 90°；懒加载时 `.spin` 旋转。

### 分段控件（`.view-switch`）
- 轨道 `--bg-2` + 边框；激活按钮在**亮色**取 `--bg-elevated` + `--shadow-sm`，在**暗色**取实心 `--accent` 填充。（Tree / JSON / Table。）

### 输入（input / select / textarea）
- `--bg-2` 填充、`--border`；聚焦：`--accent` 边框 + `0 0 0 3px var(--accent-soft)` 环。

### 弹窗（`.modal` / `.modal-backdrop`）
- 居中，`--radius-lg`，`--shadow-lg`，遮罩为中性黑 + 轻模糊。header/footer 由 `--border` 分隔。弹入动画 `.16–.18s`。
- 另有单向小弹窗 `.url-popup`（连接的 From URL / To URL）。

### 右键菜单（`.ctx-menu`）
- `--bg-1`、阴影、4px 内边距，项用 `--radius-sm`。外点击/Esc 关闭，自动夹在屏内。

### 提示条（`.toast` + `<Toaster>`）
- 右下角堆叠。**不透明的 elevated 面**（`--bg-elevated`）+ `--shadow-lg`——绝不用半透明色洗（否则背后内容透出）。严重度靠**3px 左色条 + 图标**：`error→--err`、`success→--ok`、`warn→--warn`、`info→--accent`。
- 两条通道：错误（`lastError`，常驻直到关闭）与瞬时通知（success/info ~4s 自动消、warning 常驻）。

### 结果表（`.tbl` / `.tbl-head` / `.tbl-row`）
- 粘性表头 + 发丝线下划线；粘性序号列；行 hover 染色；mono 单元格按 `--t-*` 着色。Tree 视图为 KEY|VALUE|TYPE 三列（`.kv-row`），可拖拽分界。

### 主题切换
- 在**侧栏底栏**（`.side-foot` / `.theme-cycle`），不在标题栏——它是 app 级偏好，远离查询动作。单图标循环 System → Light → Dark。`App.tsx` 把解析后的值写到 `documentElement` 的 `data-theme`，驱动 token 级联；`system` 跟随 OS 并实时响应。

---

## 5. 约定与护栏

- **只用 token。** 组件里不写裸 hex。要新颜色？在亮 + 暗两块都加 token。
- **一条发丝线，用两处。** 标题栏 + 表头。别滋生粗黑线。
- **Mono = 数据，UI sans = chrome。** 别用 mono 渲染 UI 标签，也别用 sans 渲染数据。
- **强调是结构性的，不是装饰。** 它只标主操作与当前选中。避免大面积强调填充、强调色文字段、渐变。
- **中性，绝不带调。** 若某个中性看起来发暖/发绿/发蓝，就是错的——亮色保持纯白、暗色保持中性深灰，内容待在最亮层面。
- **紧凑优先。** 默认密集布局。
- **反馈不引发布局位移。** 控件动作时保持尺寸——绝不靠改文案/字重/内边距来表达 hover/in-flight，用颜色、spinner 叠层或禁用态。（按钮用 `BusyButton`。）
- **不全大写、不 emoji、不把渐变当装饰、不搞「带左色条的卡片」套路。**
- **数据网格自己管选择——禁用原生文本选择。** 结构化结果面（**Tree** 与 **Table**）有自己的选择模型，不用浏览器的。单击即选：Tree 里选一个嵌套节点或整条顶层文档（`Shift`=范围、`⌘/Ctrl`=跨文档切换）；Table 里选整行，被点单元格在行染色之上叠高亮（`Shift`=行范围、`⌘/Ctrl`=切换；**双击编辑**单元格）。`⌘C` 复制选择（单条为对象、多条为 JSON 数组）；右键提供结构化复制（Pure JSON / Shell JS / Extended JSON）。因为 app 自管选择，这些面上原生文本选择被**禁用**（`.kv-row` / `.table-scroller` 设 `user-select: none`）——原生橡皮筋选择会把 `::selection` 画成一格格断裂的矩形（badge、`{ n fields }` 摘要、类型标签），读作「半选中的网页」，且复制的是渲染后被省略号截断的文本而非真实数据。内联单元格编辑器重新开启选择（`.cell-edit-input` 设 `user-select: text`）。真正是自由文本的面——**JSON** 结果视图、查询编辑器、提示条、输入框——保留原生选择。
- **亮色优先。** 先在亮色设计与验证，再用切换确认暗色。

---

## 6. 文件地图

主题是纯 token 驱动的：换肤只需改 `styles.css` 顶部两块变量 + `pineEditorTheme.ts`，**组件零改动**。

| 文件 | 职责 |
|---|---|
| `src/renderer/src/styles.css` | **唯一**的 CSS：设计 token（`:root` 亮 + `[data-theme='dark']` 暗）+ 基础 reset + 全部组件/布局样式 |
| `src/renderer/src/lib/pineEditorTheme.ts` | CodeMirror 的亮/暗调色板（**独立**、解析后 hex，不走 CSS var）。`ShellEditor` 按持久化主题切换——**改主题色务必与 `--t-*` token 同步** |
| `src/renderer/src/App.tsx` | 两栏外壳；把 `settings.theme`（system/light/dark）解析后写到 `data-theme` |
| `src/renderer/src/lib/ejson.ts` | **唯一**懂 EJSON-canonical 形状的地方 → 决定显示串、类型标签、可展开性 |
| `src/renderer/src/components/` | 组件：`explorer/` `shell/` `results/`（Tree/JSON/Table/Explain/DocEditor）`settings/` `io/` `sidebar/` `common/`（Button/Modal/Toast/Toaster/Tooltip 等） |
| `src/renderer/src/components/settings/SettingsModal.tsx` | 集中式设置（语言/主题/排序/每页条数/编辑器字号·换行·缩进） |

> 相关纲领：`SPEC.md`（范围）、`CONTEXT.md`（术语）、`docs/adr/0004`（性能铁律——大列表虚拟化、重活下沉 worker，任何视觉改动都不得违反）。
