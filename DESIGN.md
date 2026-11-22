# AMDM — 设计系统

**Neutral Paper + Graphite**：浅色以白色内容面和中性浅灰 Chrome 建立层级;暗色使用无色相倾向的石墨灰,通过同一套语义令牌重新映射表面、文字、边界与数据色。

浅色布局与组件构成以 `prototypes/light-ui-concept.html` 为视觉基准;Electron 使用原生窗口框架,不重复绘制原型中的窗口外壳。

## 1. 原则与令牌

- 颜色只定义在 `styles/tokens.css`;组件使用 `--surface-*`、`--interaction-*`、`--text-*` 等语义 token 或 Tailwind 语义类,不写裸 hex。
- `styles/index.css` 的 `@theme inline` 直接映射语义 token;旧 `--bg-*`、`--fg-*` 仅作为迁移期兼容别名。
- 数据与代码共用 `--t-*` 类型色。新增 BSON 类型时同步修改 `serialize-core.ts`、`lib/ejson.ts` 和 `lib/pineEditorTheme.ts`。
- 常驻表面保持扁平;阴影只用于菜单、弹窗等真正悬浮层。

## 2. 排版与密度

- 通用界面使用系统 sans;数据和代码使用 JetBrains Mono。
- 不使用纯英文大写;层级依靠字重、颜色和字距。
- 数据区紧凑，弹窗和表单舒展。
- 侧栏调宽时给编辑器和结果区留出空间。窄窗口临时收起侧栏时，保留用户的展开偏好。

## 3. Tailwind 与 CSS

- Tailwind v4 使用 CSS-first 配置,只引入 theme 和 utilities,迁移期不启用 preflight。
- 裸元素默认规则必须位于 `@layer base`,确保 Tailwind 工具类可覆盖。
- `components/ui/*` 是 `@base-ui/react` 的唯一业务门面;class 使用 `lib/utils.ts#cn` 合并。
- 新组件优先 Tailwind + `cva`;token、第三方选择器和共享数据样式保持全局;自包含复杂组件可用 CSS Module。
- `styles/index.css` 的 import 顺序是层叠契约,不得随意调整。

## 4. 组件

- 异步按钮在操作期间保持标签和宽度稳定，避免重复触发。
- 按钮默认优先无边框,通过填充色、文字色及 hover / pressed / focus 状态表达层级;仅在边界难以辨认或成组控件确需分隔时使用细边框。图标按钮必须显式控制 border、background 和 padding,并保持内容双轴居中。
- `Modal` 基于 `ui/Dialog`,保留 Esc、外点关闭、焦点陷阱与 aria 关联。
- Modal Backdrop 只做半透明压暗,不使用 `backdrop-filter` 模糊整个 App。
- 表单控件统一使用 `ui/*`;焦点保持中性边框(`--separator-strong`) + 控件外侧软焦点环。禁止使用 Ink/黑色高对比边框或 inset shadow 形成控件内部黑色描边。
- 滚动或裁剪容器要为控件外侧焦点环预留空间,聚焦时保持焦点环完整可见。
- 输入框与后缀等组成组合控件时,由外层统一负责圆角、边框和焦点环。
- 在 Electron 中验证控件的聚焦、Tab 切换和滚动边缘,覆盖明暗主题与长列表。
- Checkbox 不使用额外的外侧 focus ring,聚焦不得在方框外再增加一层环绕效果。

## 5. 布局与数据视图

- 左栏浏览 Connection,中间承载 Shell 与结果,右栏只显示已加载上下文,不得为展示额外查询。
- Tree、Table、Grid、JSON、Console 保持虚拟化或有界渲染;结构化结果使用应用自己的选择和复制模型。
- Tree/Table/Grid 禁用原生文本选择;内联编辑器、JSON、Shell 和输入框保留原生选择。
- 结果类型色来自 `--t-*`;主题由 `data-theme` 驱动。

## 6. 动效

- 动效用于表达选中位置、展开关系和操作反馈。结果数据、查询输出和大列表更新即时呈现。
- 切换和状态反馈使用共享动效令牌。选中状态移动时保持文字、点击区域和键盘焦点稳定。
- 连续操作可以中途反向。拖动分隔线时面板即时跟随指针，收起面板时立即停止内容交互。
- 尊重 `prefers-reduced-motion`，启用减少动态效果时立即呈现最终状态。
- 在 Electron 中验证连续切换、焦点、滚动和减少动态效果；面板尺寸动画还需检查编辑器与大结果集的流畅度。

## 7. 护栏

- Ink 只做结构性强调;不用渐变、装饰性 emoji 或大面积强调填充。
- 亮暗主题共享同一套语义 token;新增颜色必须提供两套映射,不能在业务组件中增加主题分支。
- 界面文案用于标识内容、指引操作和反馈状态。反馈、弹窗切换和下拉选项滚动时保持布局稳定；交互基础能力不得绕过现有无障碍原语。
