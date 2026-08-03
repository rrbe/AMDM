# AMDM — 设计系统

**Warm Stone + Ink**：暖灰纸面承载内容,石墨色只用于主操作、选中和焦点;语法与数据保留语义色。亮色与暗色同等对待。

## 1. 原则与令牌

- 颜色只定义在 `styles/tokens.css`;组件使用语义 token 或 Tailwind 语义类,不写裸 hex。
- `styles/index.css` 的 `@theme inline` 映射 shadcn 色名。项目的 `--accent` 是品牌 Ink,映射为 `primary`;shadcn `accent` 对应 `--bg-3` hover 底色。
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
- `Modal` 基于 `ui/Dialog`,保留 Esc、外点关闭、焦点陷阱与 aria 关联。
- 表单控件统一使用 `ui/*`;焦点使用 Ink 边框和软焦点环。

## 5. 布局与数据视图

- 左栏浏览 Connection,中间承载 Shell 与结果,右栏只显示已加载上下文,不得为展示额外查询。
- Tree、Table、JSON、Console 保持虚拟化或有界渲染;结构化结果使用应用自己的选择和复制模型。
- Tree/Table 禁用原生文本选择;内联编辑器、JSON、Shell 和输入框保留原生选择。
- 结果类型色来自 `--t-*`;主题由 `data-theme` 驱动。

## 6. 护栏

- Ink 只做结构性强调;不用渐变、装饰性 emoji 或大面积强调填充。
- 亮暗主题必须同时调整;新增颜色必须同时提供两套值。
- 反馈不得引发布局位移;交互基础能力不得绕过现有无障碍原语。
