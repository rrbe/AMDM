# AMDM — 设计系统

**代号：Zinc（中性锌）+ Blue。** 一套现代、克制、数据密集的桌面数据库工具外观，路线对齐 Outerbase Studio：真中性 **zinc** 表面（无暖/绿色偏），单一**蓝/靛强调色**只用于主操作 / 选中 / 焦点环；语法与数据着色保留语义彩（绿字符串、蓝数字、橙红 ObjectId…）。亮色与暗色**同等对待**。

> 视觉层建立在 **Tailwind v4 + shadcn 风原语（基于 `@base-ui/react`）** 之上，**正在从旧的纯手写 CSS 迁移**——见 `CLAUDE.md` 的「样式约定」。当前是混合态：共享表单/弹窗原语与连接弹窗已 Tailwind 化，其余分区仍是手写 CSS（已被令牌重新上色）。本文件描述目标体系与现行约定。
>
> 前身是「Slate 石墨」近单色体系（已弃用）。换肤是纯令牌级的——见 §1 与 §6。

三条原则贯穿每个决策：

1. **中性 zinc 表面，单一蓝强调。** 内容面在亮色是 `#ffffff`、暗色是近黑 zinc `#101012`；chrome（窗口框、侧栏、表头、凸起控件）逐级降到中性 zinc 灰。**无色调倾向**。蓝强调是**结构性**的，只标主操作 / 当前选中 / 焦点环，绝不大面积铺。
2. **结构化排版 + 现代细节。** 靠字重、颜色、细发丝线建立层级；偏锐圆角（5px）+ 圆角内嵌「药丸」hover（侧栏/菜单）+ 克制的短过渡。
3. **为数据工作而读。** 紧凑密度，所有数据/代码用 **JetBrains Mono**，语法着色为「扫读」调校——不是彩虹。

---

## 1. 颜色 token

所有颜色都是 CSS 自定义属性，定义在 `styles/tokens.css` 的 `:root`（亮，默认）与 `[data-theme='dark']`（暗）。**组件里绝不硬编码 hex——一律引用 token**（Tailwind 侧用 `bg-secondary`/`text-foreground` 等语义类，或 `[var(--token)]` 任意值）。`styles/index.css` 末尾的 `@theme inline` 把 shadcn 色名映射到这些令牌（**命名坑**：我们的 `--accent`=品牌蓝→映射成 shadcn `primary`；shadcn 的 `accent`=hover 底→`--bg-3`）。

### 强调色 — 蓝

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--accent` | `#2f6bff` | `#4f7fff` | 主操作（Run/Save）、激活、选中、焦点环、链接 |
| `--accent-hover` | `#1f5bef` | `#6690ff` | 强调面 hover |
| `--accent-soft` | `rgba(47,107,255,.10)` | `rgba(79,127,255,.16)` | 焦点环、激活行/标签底 |
| `--accent-soft-strong` | `rgba(47,107,255,.16)` | `rgba(79,127,255,.26)` | 选中高亮 |
| `--accent-fg` | `#ffffff` | `#ffffff` | 蓝填充上的文字/图标 |

### 表面（Surfaces，zinc）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--bg-app` | `#f4f4f5` | `#09090b` | 窗口 chrome / 面板背后 |
| `--bg-0` | `#ffffff` | `#101012` | 主内容面（工作区、列表、结果） |
| `--bg-1` | `#fafafa` | `#18181b` | 侧栏、头部 chrome、底栏 |
| `--bg-2` | `#f4f4f5` | `#27272a` | 凸起/内凹（输入、表头、分段） |
| `--bg-3` | `#e4e4e7` | `#323238` | 行/按钮 hover（= shadcn `accent`） |
| `--bg-elevated` | `#ffffff` | `#1c1c20` | 弹窗、菜单、popover |
| `--bg-sel` | `rgba(47,107,255,.10)` | `rgba(79,127,255,.18)` | 选中行底（蓝） |
| `--bg-editor` | `#ffffff` | `#0d0d0f` | 查询编辑器（CodeMirror，另见 §6） |

### 边框 / 文字 / 状态

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--border` | `#e4e4e7` | `#27272a` | 默认分隔线（= shadcn `border`） |
| `--border-strong` | `#d4d4d8` | `#3f3f46` | 控件描边（= shadcn `input`） |
| `--rule` | `#e4e4e7` | `#232327` | 标题栏 / 表头下发丝线 |
| `--fg-0` | `#18181b` | `#fafafa` | 主文字（zinc，无色调） |
| `--fg-1` | `#3f3f46` | `#d4d4d8` | 次级标签、正文 |
| `--fg-2` | `#71717a` | `#a1a1aa` | 三级、说明（= shadcn `muted-foreground`） |
| `--fg-3` | `#a1a1aa` | `#71717a` | 禁用、占位、计数 |
| `--ok` | `#16a34a` | `#34d399` | 成功 / 在线 |
| `--warn` | `#b45309` | `#e0a23a` | 警告 / 截断 |
| `--err` | `#dc2626` | `#ff6f5c` | 错误（= shadcn `destructive`） |

### 语法 / 数据着色（`--t-*`）

查询编辑器与结果单元格共用同一套类型色。**新增任何 BSON 类型，都要同时改这里、`lib/ejson.ts`、序列化 core，并同步 `lib/pineEditorTheme.ts` 的解析 hex**（编辑器另持一份；改 `--t-*` 务必两边同步）。

| Token | Light | Dark | 应用于 |
|---|---|---|---|
| `--t-key` | `#18181b` | `#fafafa` | 对象键（同正文色） |
| `--t-string` | `#1a8f4c` | `#5fd39a` | 字符串（绿） |
| `--t-number` / `--t-date` | `#2563eb` | `#74a8ff` | 数字 / ISODate / Timestamp（蓝） |
| `--t-boolean` / `--t-regex` | `#8a3fd0` | `#c79bff` | 布尔 / 正则（紫） |
| `--t-objectId` / `--t-binary` / `--t-special` | `#c0481f` | `#ff8a5c` | ObjectId / BinData / MinKey 等（橙红） |
| `--t-null` | `#a1a1aa` | `#71717a` | null / undefined（灰） |

### 阴影

`--shadow-sm/md/lg` 为中性纯黑 rgba（无色调）。常驻表面、按钮和分段控件保持扁平，靠背景与边框定义；阴影只留给真正悬浮的东西（菜单、弹窗）。

---

## 2. 排版

```
--font-ui:   system-ui, sans-serif;                                                 /* UI chrome */
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Monaco, monospace;  /* 数据 / 代码 */
--fs: 13px;  --fs-sm: 12px;
/* 排版尺度令牌（替代散落字面量）：*/
--fw-normal/medium/semibold/bold: 400/500/600/700;
--lh-tight/snug/normal/relaxed:   1.2/1.35/1.45/1.6;
--ls-tight/normal/wide:           -0.01em/0/0.01em;
```

- **系统 sans** — 通用 chrome（标签、按钮、标题），在 macOS 上自然使用系统字体；连接列表单独使用 Helvetica Neue。
- **JetBrains Mono（OFL-1.1，可商用，`@fontsource` 离线打包）** — *所有数据与代码*（编辑器、结果表、ObjectId、库名 chip）。
- **不使用纯英文大写**（`text-transform: uppercase` 全站清除）；层级靠字重 + 颜色 + 细微字距，标签一律**大驼峰**。

---

## 3. 形状、间距、密度

```
--radius:    5px;   /* 默认 — 按钮、输入、行、分段 */
--radius-sm: 4px;   /* 密集控件、菜单项、树行药丸 */
--radius-lg: 9px;   /* 弹窗 */
--row-h:     24px;  /* 目录树 / 结果行高 */
```

- 圆角**偏锐**——存在但克制，不是 pill UI。
- **密度**：数据区紧凑优先（给想一屏看大量数据的人）；**弹窗/表单则舒展**——Modal 三档宽度 `sm 480 / md 660(默认) / lg 760`，内边距 `px-6 py-5`，字段 16px 节奏。这是一个宽应用，弹窗应显著宽。
- **可拖拽尺寸**：`--sidebar-width`(300px) / `--editor-height`(120px) 由 JS 从持久化设置覆写。

---

## 4. 架构（Tailwind + shadcn 风原语）

详见 `CLAUDE.md`「样式约定」。要点：

- **Tailwind v4 CSS-first**（无 `tailwind.config`）：`@tailwindcss/vite` 插件 + `@` 别名。`index.css` 顶部只引 theme+utilities 层、**不引 preflight**（迁移期避免全局 reset）；末尾 `@theme inline` 映射 shadcn 色名。
- **`@layer base` 兜底**：裸元素默认规则（`base.css` 全文 + `theme-polish.css` 通用 `button/input/...` 块）收进 base 层，让迁移组件的 Tailwind 工具类盖过它们。**新组件用 Tailwind 即可生效。**
- **shadcn 风原语** = `@base-ui/react` 无样式原语 + Tailwind + `cva` 变体；class 合并用 `lib/utils.ts#cn`。门面在 `components/ui/*`（对外 props 不变，业务不直接 import Base UI）。

---

## 5. 组件

### 按钮（`common/Button.tsx`，cva）
- 变体 `default | primary | ghost | danger`（+ `busy`）。`primary` = 蓝填充 + 白字；`default` = secondary 底 + 描边；`ghost` = 透明到 hover；`danger` = 红字 / hover 红底。
- **跨状态等宽。** 标签固定，**不得**在 idle 与 in-flight 间变文案。用 `<Button busy>`：标签留在流内但隐形、叠居中 spinner（`.busy-btn*`，`currentColor` 自适应变体），忙碌时自动禁用。任何异步动作都用它。
- 不用于纯图标按钮、分段切换、菜单项——那些保持原生 `<button>`。

### 弹窗（`common/Modal.tsx` + `ui/Dialog`）
- elevated 卡片壳（圆角 `xl`、描边、`shadow`），居中在 dimmed backdrop 上；三档宽度（§3）。定位/backdrop 由 `ui/Dialog`（Base UI Dialog，Esc / 外点关闭、焦点陷阱、aria 由它提供，受控 `open`）。

### 表单控件（`ui/*`）
- `Input`/`Select` 触发器：h-9 zinc inset 框，蓝聚焦边框 + `0 0 0 3px var(--accent-soft)` 软环。`Select`/`Menu` 弹层是描边卡片，高亮项用 `--bg-3`。`Checkbox` 选中填蓝。`Tabs` 下划线式（选中蓝下划线 + 文字）。`Field` 为 label+control+hint+error 的竖向栈。

### 侧栏 / 目录树（`explorer.css`）
- 连接行：full-bleed sticky band（粘性滚动 = 子树 section header），激活态 `--bg-sel` + `inset` 蓝描边；左缘 3px 环境色。
- 目录树行 / 分组头：**圆角内嵌药丸** hover（`--bg-3`/`--bg-2`）。状态点（在线/错误/连接中/离线）= 颜色 + 光晕。

### 分段控件 / 结果（`.view-switch`、`results.css`）
- 视图切换（Tree/JSON/Table）：轨道 `--bg-2`，激活段在亮色取 `--bg-elevated`，暗色取蓝填充。
- 结果表/树：**虚线网格**（`1px dashed var(--border)`，刻意保留）、KEY|VALUE|TYPE 三列、`--t-*` 类型着色、粘性表头。

### 主题切换
- 侧栏底栏单图标循环 System → Light → Dark；`App.tsx` 把解析值写到 `documentElement` 的 `data-theme`，驱动令牌级联。

---

## 6. 约定与护栏

- **只用 token。** 组件里不写裸 hex；要新颜色就在亮+暗两块都加。Tailwind 侧用语义类或 `[var(--token)]`。
- **强调是结构性的。** 蓝只标主操作与当前选中；避免大面积强调填充、强调色文字段、渐变。
- **中性 zinc，绝不带调。** 看起来发暖/发绿就是错的。
- **亮/暗平等。** 两套都精心调，互不将就。
- **反馈不引发布局位移。** 控件动作时保持尺寸（按钮用 `busy`）。
- **不全大写、不 emoji、不把渐变当装饰。**
- **数据网格自己管选择——禁用原生文本选择。** 结构化结果面（**Tree** / **Table**）有自己的选择模型（单击选、`Shift`/`⌘` 多选、双击编辑、`⌘C` 复制、右键结构化复制），故禁用原生选择（`.kv-row` / `.table-scroller` 设 `user-select: none`）——否则原生橡皮筋选择会把 `::selection` 画成断裂矩形且复制的是被省略号截断的文本。内联单元格编辑器（`.cell-edit-input`）重开选择；JSON 视图、编辑器、输入框保留原生选择。
- **数据视图保密集，弹窗/表单保舒展。**

---

## 7. 文件地图

| 文件 | 职责 |
|---|---|
| `src/renderer/src/styles/tokens.css` | 设计令牌（`:root` 亮 + `[data-theme='dark']` 暗）——换肤只改这里 |
| `src/renderer/src/styles/index.css` | 入口：Tailwind theme+utilities 引入、11 分区 @import（层叠契约）、`@theme inline` 映射 |
| `src/renderer/src/styles/*.css` | 手写分区（迁移中逐步清退到 Tailwind）：`base`/`app-shell`/`explorer`/`work-area`/`results`/`modals-forms`/`phase2`/`phase3`/`theme-polish`/`base-ui` |
| `src/renderer/src/lib/utils.ts` | `cn()`（clsx + tailwind-merge），shadcn 风组件用 |
| `src/renderer/src/lib/pineEditorTheme.ts` | CodeMirror 亮/暗调色板（**独立**解析 hex）——改主题色务必与 `--t-*` 同步 |
| `src/renderer/src/components/ui/*` | shadcn 风门面（Dialog/Select/Input/Field/Checkbox/Tabs/…，基于 Base UI，对外 props 稳定） |
| `src/renderer/src/components/common/` | Button(cva)/Modal/Toast/Toaster/Tooltip 等 |
| `src/renderer/src/App.tsx` | 两栏外壳；把 `settings.theme` 解析后写到 `data-theme` |
| `src/renderer/src/lib/ejson.ts` | **唯一**懂 EJSON-canonical 形状处 → 显示串、类型标签、可展开性 |

> 相关纲领：`SPEC.md`（范围）、`CONTEXT.md`（术语）、`docs/adr/0004`（性能铁律——大列表虚拟化、重活下沉 worker，任何视觉改动不得违反）、`CLAUDE.md`（样式约定 / 进程架构 / IPC 接缝）。
