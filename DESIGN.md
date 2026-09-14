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
- 数据区紧凑,弹窗和表单舒展;圆角保持 6–10px,目录及结果行高 24px。
- Modal 宽度为 `sm 480 / md 660 / lg 760`;侧栏和编辑器尺寸由设置持久化。

## 3. Tailwind 与 CSS

- Tailwind v4 使用 CSS-first 配置,只引入 theme 和 utilities,迁移期不启用 preflight。
- 裸元素默认规则必须位于 `@layer base`,确保 Tailwind 工具类可覆盖。
- `components/ui/*` 是 `@base-ui/react` 的唯一业务门面;class 使用 `lib/utils.ts#cn` 合并。
- 新组件优先 Tailwind + `cva`;token、第三方选择器和共享数据样式保持全局;自包含复杂组件可用 CSS Module。
- `styles/index.css` 的 import 顺序是层叠契约,不得随意调整。

## 4. 组件

- `Button` 提供 `default / primary / ghost / danger` 和 `busy`;异步状态保持标签及宽度不变,忙碌时自动禁用。
- 按钮默认优先无边框,通过填充色、文字色及 hover / pressed / focus 状态表达层级;仅在边界难以辨认或成组控件确需分隔时使用细边框。图标按钮必须显式控制 border、background 和 padding,并保持内容双轴居中。
- `Modal` 基于 `ui/Dialog`,保留 Esc、外点关闭、焦点陷阱与 aria 关联。
- Modal Backdrop 只做半透明压暗,不使用 `backdrop-filter` 模糊整个 App。
- 表单控件统一使用 `ui/*`;焦点保持中性边框(`--separator-strong`) + 控件外侧软焦点环。禁止使用 Ink/黑色高对比边框或 inset shadow 形成控件内部黑色描边。
- Checkbox 不使用额外的外侧 focus ring,聚焦不得在方框外再增加一层环绕效果。

## 5. 布局与数据视图

- 左栏浏览 Connection,中间承载 Shell 与结果,右栏只显示已加载上下文,不得为展示额外查询。
- Tree、Table、JSON、Console 保持虚拟化或有界渲染;结构化结果使用应用自己的选择和复制模型。
- Tree/Table 禁用原生文本选择;内联编辑器、JSON、Shell 和输入框保留原生选择。
- 结果类型色来自 `--t-*`;主题由 `data-theme` 驱动。

## 6. 动效

- 动效用于表达选中位置、展开关系和操作反馈。结果数据、查询输出和大列表更新即时呈现。
- 常规切换使用 `--motion-base`（180ms）与 `--ease-standard`，先快后缓；hover 和颜色反馈使用 `--motion-fast`（120ms）。
- 分段切换和设置分类移动选中背景，文字和点击区域保持固定；图标与文字组合展开时固定图标尺寸、内边距和字重，仅过渡文字宽度与透明度。
- 目录搜索在标题行内从右向左展开，覆盖标题与数量，右侧保留取消按钮；取消后恢复标题行，列表位置保持稳定。侧栏展开使用宽度、透明度和短距离位移。面板内部保持稳定宽度，拖动分隔线时即时跟随指针。
- 复制等状态反馈保留按钮尺寸，使用图标淡入淡出和轻微缩放。连续操作从当前动画位置继续，支持中途反向切换，不阻塞输入。
- 保持切换控件的 DOM 身份与键盘焦点；面板收起时立即停止内容交互，退出动画结束后卸载并释放资源。复用 `ui/Collapsible` 管理展开与退出生命周期。
- 尊重 `prefers-reduced-motion`，减少动态效果时立即呈现最终状态。动效使用现有语义令牌，亮暗主题保持一致。
- 在 Electron 中验证连续切换、焦点、滚动和减少动态效果；面板尺寸动画还需检查编辑器与大结果集的流畅度。

## 7. 护栏

- Ink 只做结构性强调;不用渐变、装饰性 emoji 或大面积强调填充。
- 亮暗主题共享同一套语义 token;新增颜色必须提供两套映射,不能在业务组件中增加主题分支。
- 反馈不得引发布局位移;交互基础能力不得绕过现有无障碍原语。
