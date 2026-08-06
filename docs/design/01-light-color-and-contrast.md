# AMDM 浅色配色与对比规范草案

> 状态：待评审、未实施。本文件记录目标方向，不替代当前根目录的 `DESIGN.md`。
>
> 关联文档：[设计语言](./02-design-language.md) · [暗黑模式](./03-dark-mode.md)

## 1. 目标

浅色主题从现有 **Warm Stone + Ink** 调整为更中性的 **Neutral Paper + Graphite**：

- 主工作区回归纯白，保证代码和数据是视觉中心。
- 侧栏与标签栏使用无绿、无黄倾向的中性浅灰，与内容区形成轻微层级。
- Hover、Selected、Pressed 使用透明石墨覆盖层，不使用厚重的实心灰色。
- 依靠表面、留白、字重建立层级；不依靠大量分隔线和容器边框。
- 状态色与 BSON 类型色保留语义，但不参与大面积背景。

本轮不改变 Tree、JSON、Table、Console 的数据交互模型，不改变布局尺寸持久化、虚拟化、复制和选择行为。

## 2. 当前问题

当前浅色令牌的主表面为 `#edece8`、侧栏为 `#e6e7e2`、窗口底色为 `#e1e2dd`。这些暖灰叠加后容易呈现绿褐色偏色；再叠加实色 Hover、边框和圆角容器，会让界面显脏并削弱文字对比。

问题不是单个颜色选错，而是同时存在过多接近但不相同的暖灰表面。新的浅色主题应限制常驻表面数量，并把交互状态改为透明覆盖层。

## 3. 表面模型

常驻界面最多使用以下表面：

| 语义 | 建议值 | 使用范围 |
|---|---:|---|
| `--surface-canvas` | `#ececef` | 窗口外或面板后的底色；应用内部通常不直接可见 |
| `--surface-content` | `#ffffff` | 工作区、结果区、主要内容区 |
| `--surface-sidebar` | `#f7f7f8` | 左侧栏、安静的辅助区域 |
| `--surface-chrome` | `#f1f1f3` | 查询标签栏、结果标签栏 |
| `--surface-inset` | `#fafafa` | 代码编辑器、轻微下沉的数据输入区域 |
| `--surface-control` | `#f5f5f7` | 输入框、Select、分段控件底座 |
| `--surface-elevated` | `#ffffff` | Menu、Popover、Tooltip、Dialog |

规则：

- 主要内容必须使用 `--surface-content`，不得再用带色暖灰替代白色。
- 侧栏和标签栏通过表面差异与内容区分离，不额外叠加粗边框或阴影。
- `--surface-inset` 只用于确实需要“输入/编辑”语义的区域，不能拿来包裹整个表单分组。
- 常驻侧栏不使用 `backdrop-filter`。没有内容从侧栏后方经过时，模糊只增加 GPU 成本，不产生有效玻璃感。
- “玻璃感”主要来自透明交互层，而不是持续模糊。

## 4. 交互层

透明交互层应能叠加在白色或浅灰表面上，并保持一致强度：

| 状态 | 建议值 |
|---|---:|
| `--interaction-hover` | `rgba(22, 24, 29, 0.045)` |
| `--interaction-selected` | `rgba(22, 24, 29, 0.075)` |
| `--interaction-pressed` | `rgba(22, 24, 29, 0.11)` |
| `--focus-soft` | `rgba(22, 24, 29, 0.08)` |

- Hover 不应比 Selected 更深。
- Selected 必须保留底层表面的亮度，不能用不透明深灰覆盖文字。
- Pressed 只在指针按下期间出现，不作为持久选中状态。
- 表格行、目录行、普通按钮和标签关闭按钮共用同一套透明强度。
- 状态不能只靠颜色表达；连接状态仍需保留形状、文本、Tooltip 或可访问标签。

## 5. 文字、边界与主操作

| 语义 | 建议值 |
|---|---:|
| `--text-primary` | `#202124` |
| `--text-secondary` | `#55585f` |
| `--text-muted` | `#898c93` |
| `--text-disabled` | `#b2b4ba` |
| `--separator` | `rgba(22, 24, 29, 0.09)` |
| `--separator-strong` | `rgba(22, 24, 29, 0.16)` |
| `--primary` | `#242529` |
| `--primary-hover` | `#101114` |
| `--primary-foreground` | `#ffffff` |

对比要求：

- 普通正文以 4.5:1 为最低目标。
- 大文字、图标和必要的控件边界以 3:1 为最低目标。
- Muted 文字只用于辅助信息，不承载必需操作和错误信息。
- 禁用状态不能仅降低到不可读；同时通过不可交互状态和光标表达。
- Focus 必须清晰可见，不能为了“干净”删除键盘焦点反馈。

## 6. 状态色与数据色

状态与 BSON 类型继续使用颜色，但降低大面积填充：

| 语义 | 建议值 |
|---|---:|
| Success / String | `#2d9b63` |
| Warning | `#b87427` |
| Error | `#d84a4a` |
| Number / Date | `#4f73d9` |
| Boolean / Regex | `#8657b8` |
| ObjectId / Binary / Special | `#c66a3d` |
| Null | `#8d9097` |

- 错误、警告背景使用对应颜色的 8%–10% 透明层，不使用大面积高饱和实色。
- Tree、Table、JSON、Console 和 CodeMirror 必须使用同一语义颜色。
- 修改数据色时同步检查 `tokens.css`、`pineEditorTheme.ts` 与 EJSON 显示。

## 7. 组件应用

### 侧栏

- 使用 `--surface-sidebar`，不加外阴影。
- Connections 标题、导航和底部设置区优先使用留白区分。
- 删除仅用于“框出区域”的分隔线；窗口拖动、Resize Handle 等功能线保留。
- 目录行使用透明 Hover/Selected；选中态不再叠加不透明灰底和描边。

### 查询与结果标签栏

- 标签栏使用 `--surface-chrome`。
- 活动标签使用 `--surface-content`，与下方内容无缝连接。
- 非活动标签之间使用 `--separator-strong` 的短竖线。
- 活动标签及其左右相邻位置隐藏竖线。
- 标签不使用外阴影。

### 工作区与编辑器

- 工作区和结果区使用纯白。
- 编辑器可使用 `--surface-inset`，但不再额外套有边框的外层卡片。
- 工具栏与内容之间只在需要固定结构时保留一条 Hairline。

### 数据视图

- Tree、JSON、Table、Console 的交互结构保持现状。
- Tree / JSON / Table 继续使用有边界的分段控件，为右侧分页、复制、展开等操作保留固定区域。
- 表格允许使用横向 Hairline；默认不添加竖向网格线。

### 表单与弹窗

- Dialog 是唯一主要圆角容器。
- 输入框使用 `--surface-control`；静止时边框可弱化，Hover/Focus 时增强。
- 表单分组使用标题与间距，不使用灰色卡片套白色输入框。
- Hosts、Options 等真正具有表格结构的内容可保留单层边界和行分隔线。
- From URL / To URL 等次要操作优先使用 Ghost/Text Button，不单独制作带边框卡片。

## 8. 迁移兼容

实施初期可使用兼容别名，避免一次改写全部旧 CSS：

```css
--bg-app: var(--surface-chrome);
--bg-0: var(--surface-content);
--bg-1: var(--surface-sidebar);
--bg-2: var(--surface-control);
--bg-3: var(--interaction-hover);
--bg-elevated: var(--surface-elevated);
--bg-sel: var(--interaction-selected);
--bg-editor: var(--surface-inset);
```

新代码应使用语义名称；旧名称只作为迁移期兼容层。完成迁移后删除旧别名，避免两套词汇长期并存。

## 9. 禁止项

- 带绿、黄或褐倾向的大面积灰色背景。
- 用不同深浅的灰色卡片反复嵌套。
- 为标题、工具栏、侧栏分组默认添加四边边框。
- 用不透明深灰表达 Hover 或 Selected。
- 为常驻表面添加阴影、玻璃模糊或装饰性渐变。
- 为了统一外观而修改已经成熟的数据选择、复制、虚拟化和分页交互。

## 10. 验收清单

- 1440×900、1100×720 和最小支持窗口宽度下层级清楚。
- 白色工作区与中性侧栏有区别，但不存在绿褐偏色。
- Hover、Selected、Pressed 可以区分，且文字对比不下降。
- 键盘 Focus 在按钮、输入框、Tab、Select 上均可见。
- 查询标签、结果标签和下方内容能形成连续表面。
- Tree / JSON / Table 分段控件和右侧操作区保持原有结构。
- 连接弹窗不存在非必要的“圆角框套圆角框”。
- 静态截图与真实 Electron 窗口均完成视觉检查；类型检查不能替代视觉验收。
