# AMDM 设计语言重构草案

> 状态：待评审、未实施。本文件描述未来设计语言；根目录 `DESIGN.md` 在实施和验收前继续是当前规范。
>
> 关联文档：[浅色配色与对比](./01-light-color-and-contrast.md) · [暗黑模式](./03-dark-mode.md)

## 1. 设计目标

AMDM 是性能优先的 MongoDB 工具。设计应让 Connection、Query、Result 成为主角，而不是让面板、圆角和装饰抢占注意力。

新的设计语言遵循六条原则：

1. **层级先于装饰**：优先通过表面、留白、字重和位置表达结构。
2. **常驻界面扁平**：阴影只属于真正离开页面平面的临时浮层。
3. **边界必须有功能**：只有输入、选择、数据结构、Resize 或浮层边缘需要线。
4. **交互状态透明**：Hover、Selected、Pressed 使用透明覆盖层，不使用厚重实色块。
5. **不同任务使用不同控件语言**：文档标签、视图切换、表单导航不能强行统一成一种 Tab。
6. **不为重构而重构**：保留成熟的数据交互、虚拟化、键盘、选择和复制模型。

## 2. 表面与层级

### Level 0：常驻表面

- 侧栏、标签栏、工作区、编辑器和结果区。
- 不使用外阴影。
- 不通过带边框的卡片反复嵌套。
- 层级来自语义表面，具体值见配色文档。

### Level 1：轻浮层

- Select、Menu、Popover、Tooltip、查询标签纵向选择器。
- 使用单层边界和 `--shadow-popover`。
- 浮层内部项目使用透明 Hover，不再套卡片。

### Level 2：模态浮层

- Dialog、Modal、嵌套 URL 弹窗。
- 使用单层外边界、Backdrop 和 `--shadow-dialog`。
- Modal 内部不再用卡片模拟更多“层级”。

Toast 复用 Level 1。Focus Ring、表格选中描边和内联编辑边界不是 Elevation，不归入阴影等级。

## 3. 边界规则

### 允许使用边界

| 场景 | 规则 |
|---|---|
| Input、Select、Textarea | 静止时弱边界或无边界；Hover/Focus 时增强 |
| Tree / JSON / Table 分段控件 | 保留完整外边界，内部模式有明确分隔 |
| 数据表格 | 保留表头底线和横向行分隔；默认不使用竖向网格 |
| Hosts、Options 等结构化表单列表 | 允许一个外边界和必要的行/列分隔 |
| Resize Handle | 保留功能 Hairline 与 Hover 反馈 |
| Menu、Popover、Tooltip、Dialog | 使用单层外边界帮助浮层从背景中分离 |
| 错误、警告、Focus | 可使用语义边界，但不能只靠颜色传达状态 |

### 默认不使用边界

- 侧栏的 Connections 标题区。
- 导航组、工具栏和 Footer。
- 普通 Section、Field Group 和说明文字。
- 查询标签与结果标签的四边框。
- 目录选中行的额外描边。
- 仅用于“看起来像一组”的外层卡片。

任何新增边界都需要回答：“它表达了什么操作或数据结构？”答不出来就删除。

## 4. 圆角与嵌套

建议语义尺寸：

| 语义 | 尺寸 |
|---|---:|
| `--radius-control` | `6px` |
| `--radius-row` | `8px` |
| `--radius-tab` | `10px 10px 0 0` |
| `--radius-dialog` | `14px` |

规则：

- 同一层级中的控件使用同一圆角，不随意出现 5、6、7、8、10、12px 的混用。
- 圆角只用于可点击状态、输入控件或真实容器，不用于每个文字分组。
- 有背景和圆角的父容器内，子区域默认保持平面；只有独立控件可以再有自己的圆角。
- Modal 可以有圆角，Modal 内的表单 Section 不再有灰底圆角卡片。
- 表格单元格、行和连续工具栏内部不逐个加圆角。
- 嵌套圆角必须有独立交互语义，否则视为设计缺陷。

## 5. 排版与密度

- 通用界面继续使用系统 Sans；代码和数据继续使用 JetBrains Mono。
- 不使用纯英文大写。技术词汇按正常大小写显示。
- 标题依靠字重和留白，不依靠底线、灰底卡片或过大的字号。
- Connection 名称保持中等字重，不与页面标题争夺层级。
- 数据区保持紧凑，结果行高和虚拟化策略不因视觉重构改变。
- 表单通过 14–16px Field Gap、24–28px Section Gap 获得舒展感，不通过容器套容器获得间距。
- 图标按钮需要固定点击区域，图标本身不因密度压缩而小于可识别尺寸。

## 6. 三类 Tab

### 6.1 文档标签：Query Tabs 与 Result Tabs

用于表示多个可关闭、可切换的文档或运行结果，采用 Chrome 式表面融合：

- 标签栏使用 Chrome Surface；活动标签使用与下方内容完全相同的 Content Surface。
- 活动标签仅保留顶部圆角，底部不画边界，使标签与内容成为连续表面。
- 非活动标签之间绘制短竖线，不为每个标签画完整边框。
- 活动标签及其左右相邻位置隐藏竖线。
- 非活动标签 Hover 使用透明交互层。
- Close、状态 Spinner、失败 Dot 继续占固定槽位，避免标签宽度跳动。
- 中键关闭、键盘快捷键和运行状态保持现有行为。
- 标签本身不使用外阴影和缩放动画。

Query Tabs：

- `.tab-strip` 继续使用原生水平滚动。
- 标签需设置不可继续压缩的合理宽度，使数量过多时真正产生 Overflow，而不是把文字压到不可识别。
- 右侧增加图标型纵向选择器，列出所有 Query Tabs。
- 纵向选择器优先复用现有 `ui/Select` 和 Base UI 能力，不引入新依赖。
- 从选择器切换后，活动标签应 `scrollIntoView` 到水平列表可见区域。
- 选择器必须保留键盘导航、焦点恢复和可访问名称。

Result Tabs：

- 使用相同的文档标签视觉语言。
- 当前结果标签上限为 8，保留原生水平滚动即可。
- 不默认增加第二个纵向选择器；只有上限提高或真实使用证明需要时再增加。

### 6.2 视图切换：Tree / JSON / Table / Console

这是固定模式切换，不是文档标签：

- 保留当前有外边界的分段控件。
- 控件占据固定区域，为右侧 Meta、分页、Copy、Expand 和未来按钮保留稳定布局。
- 活动模式有清晰填充，不能与右侧工具按钮混成一排普通文本 Tab。
- 快捷键、Console 条件显示和现有 ResultPanel 行为保持不变。

### 6.3 表单导航：General / Authentication / SSH / TLS

- 使用简洁的下划线或文本导航。
- 不与下方内容做 Chrome 式曲面连接。
- 不包进分段卡片，不使用大面积选中背景。
- 保留 Base UI Tabs 的键盘导航和 ARIA 语义。

## 7. 阴影

只定义两个真正的 Elevation Token：

```css
--shadow-popover:
  0 12px 36px rgba(24, 24, 28, 0.14),
  0 2px 8px rgba(24, 24, 28, 0.06);

--shadow-dialog:
  0 28px 80px rgba(24, 24, 28, 0.22),
  0 4px 18px rgba(24, 24, 28, 0.10);
```

- Menu、Select Popup、Tooltip、Toast 使用 `--shadow-popover`。
- Dialog、Modal、嵌套 URL 弹窗使用 `--shadow-dialog`。
- 常驻侧栏、标签栏、工具栏、编辑器、结果区和表格不使用外阴影。
- Focus Ring 可继续由 `box-shadow` 实现，但必须使用独立 Focus Token，不能复用 Elevation Token。
- 选中描边、Inset Border 和状态 Halo 也不归入 Elevation。
- 禁止发光阴影、彩色阴影和多层装饰性阴影。

暗色阴影值与边界组合见暗黑模式文档。

## 8. 动画与动态反馈

### 时间与缓动

```css
--motion-fast: 120ms;
--motion-base: 180ms;
--motion-slow: 220ms;
--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
```

| 场景 | 规则 |
|---|---|
| Hover、Focus、颜色、透明度 | `--motion-fast` |
| Menu、Popover、Toast 进入 | `--motion-base` |
| 侧栏或 Context Panel 展开 | `--motion-base`，仅在真实实现支持时使用 |
| Tab 切换 | 表面与文字状态接近即时；不移动、不弹跳 |
| Busy Spinner | 功能性循环动画，可以保留 |
| Connection Ping | 装饰性循环动画，Reduced Motion 下关闭 |

规则：

- 只动画 `opacity` 和 `transform` 等低成本属性；颜色和边界可做短过渡。
- 不用动画掩盖请求延迟，不制造假的 Loading 时间。
- 动画不得改变布局尺寸，不得让按钮文字或工具栏位置跳动。
- 不添加 Hover Scale、Bounce、Elastic、背景渐变流动等装饰动画。
- 不为实现退出动画而重构 Modal 挂载生命周期；先保留可靠的关闭行为。
- 主题切换直接更新 Token，不给所有元素添加全局颜色过渡。

### Reduced Motion

必须新增 `prefers-reduced-motion: reduce` 规则：

- 关闭非必要位移、缩放、Ping 和平滑滚动。
- 将非必要过渡时间降至接近 0。
- 功能性 Busy 状态仍需通过文字、图标或静态状态可识别，不能只依赖旋转。

## 9. 组件规则

### Button

- Primary 只用于当前区域最重要的一个动作，如 Run、Save。
- Ghost 用于工具栏和次要操作。
- Danger 只在破坏性动作中出现。
- Busy 时标签和宽度稳定，不能产生布局位移。
- 图标按钮必须有 Tooltip 或可访问名称。

### Input、Select、NumberField

- 使用 Control Surface，不再以厚重边框制造凹陷感。
- Focus 通过边界和软 Focus Ring 明确表达。
- 不删除验证、错误和禁用状态。
- Hosts、Options 等网格内部允许无圆角的连续输入，避免每格都成为独立胶囊。

### Modal 与 Form

- Modal 是单一主容器，Header、Body、Footer 通过间距组织。
- Header/Footer Hairline 只有在内容滚动或固定操作区需要时使用。
- 表单 Section 使用标题与间距，不使用卡片背景。
- 弹窗高度变化继续遵守固定顶部边缘的现有行为。

### Sidebar 与 Explorer

- 侧栏使用单一辅助表面。
- Connections、Databases 与下方 Saved Queries/History 的现有产品边界保持不变。
- Sticky Connection Row 必须保持不透明合成，防止滚动内容穿透；视觉上仍应匹配透明 Selected 强度。
- 状态 Dot 可以保留语义色与轻 Halo，但不能成为大面积装饰。

### Data Views

- Tree、Table、JSON、Console 不因为设计重构改写数据流或渲染结构。
- 虚拟化、有界渲染、选择、复制、内联编辑和分页是硬约束。
- 数据色使用共享语义 Token。

## 10. CSS 与组件工程边界

- 颜色、圆角、阴影和 Motion Token 定义在 `styles/tokens.css`。
- `styles/index.css` 的 Import 顺序继续作为层叠契约，不为视觉重构随意调整。
- 迁移旧分区时，删除已被新样式替代的后置覆盖，避免 `theme-polish.css` 与 Tailwind 双重控制同一属性。
- 新代码使用语义 Token；迁移期旧 `--bg-*` 可做兼容别名，但不能永久保留两套词汇。
- 业务组件继续只通过 `components/ui/*` 使用 Base UI；不直接引入 Base UI 原语。
- 不新增动画库、Tab 库或主题库；CSS、现有 Base UI 和浏览器原生滚动足够。
- CodeMirror 使用独立 Hex Theme，配色变化必须同步 `pineEditorTheme.ts`。
- Dark Theme 优先只覆盖语义 Token，不在业务组件中散落主题判断。

## 11. 建议实施范围

第一阶段：规范与 Token

- `DESIGN.md`
- `styles/tokens.css`
- `styles/index.css`
- `lib/pineEditorTheme.ts`

第二阶段：外壳与文档标签

- `styles/app-shell.css`
- `styles/explorer.css`
- `styles/work-area.css`
- `styles/results.css`
- `components/shell/ShellWorkspace.tsx`（仅 Query Tab 纵向选择器与滚动定位）

第三阶段：表单与浮层

- `components/common/Modal.tsx`
- `components/sidebar/ConnectionForm.tsx`
- `components/ui/Input.tsx`
- `components/ui/Select.tsx`
- `components/ui/NumberField.tsx`
- `components/ui/Tabs.tsx`
- 相应的旧 CSS 分区清理

默认不修改：

- `TreeView.tsx`
- `TableView.tsx`
- `JsonView.tsx`
- `ConsoleView.tsx`
- Store、IPC、MongoDB、序列化和持久化逻辑

## 12. 验收清单

- 三类 Tab 的视觉和交互边界明确，没有全局套用同一种样式。
- 查询标签过多时可以水平滚动，也可以从纵向选择器定位。
- 活动 Query/Result Tab 与下方内容表面连续，非活动标签之间有竖线。
- Tree / JSON / Table 分段控件和右侧操作区保持稳定。
- 常驻界面没有装饰性外阴影。
- Modal、Menu、Tooltip、Toast 使用正确的语义阴影等级。
- 圆角嵌套只发生在真正独立的交互控件上。
- `prefers-reduced-motion` 有明确行为。
- Keyboard Focus、ARIA、Esc、外点关闭和焦点恢复不退化。
- `pnpm typecheck` 与 `pnpm test:unit` 通过。
- Electron 中完成浅色、暗色、窄窗口、多标签、连接弹窗和浮层的人工视觉检查。
