# AMDM 暗黑模式规范草案

> 状态：待评审、未实施。本文件定义浅色方向稳定后的暗黑模式映射。
>
> 关联文档：[浅色配色与对比](./01-light-color-and-contrast.md) · [设计语言](./02-design-language.md)

## 1. 目标

暗黑模式不是浅色模式的简单反色，也不是另一套组件设计。它必须保持完全相同的：

- 信息层级与布局。
- 三类 Tab 的产品边界。
- 边框使用规则。
- 圆角、阴影等级和动画时长。
- 键盘、焦点、选择、复制、虚拟化和分页行为。

暗黑模式只重新映射语义表面、文字、边界和数据色。组件不应因为主题不同而走另一套 JSX 或业务逻辑。

## 2. 当前问题

当前暗色表面使用 `#141512`、`#191a17`、`#20211d`、`#2a2b26` 等 Warm Stone 色值，仍带绿褐倾向。多个接近但偏色不同的深灰叠加后，会显得浑浊；纯浅色文字与高饱和数据色又容易显得刺眼。

新的暗色主题应使用无明显色相倾向的中性石墨灰，并限制表面数量。不要用纯黑 `#000000` 作为主背景：纯黑会吞掉层级，也会让白色文字和高亮控件过于刺眼。

## 3. 暗色表面

| 语义 | 建议值 | 使用范围 |
|---|---:|---|
| `--surface-canvas` | `#111113` | 窗口后的最低层背景 |
| `--surface-chrome` | `#18181a` | Query/Result 标签栏 |
| `--surface-sidebar` | `#1c1c1f` | 左侧栏、辅助区域 |
| `--surface-content` | `#212124` | 工作区、结果区、主要内容 |
| `--surface-inset` | `#1b1b1e` | 编辑器、下沉输入区域 |
| `--surface-control` | `#29292d` | Input、Select、分段控件底座 |
| `--surface-elevated` | `#2c2c31` | Menu、Popover、Tooltip、Dialog |

规则：

- Chrome Surface 比 Content Surface 更暗，活动标签才能自然融入内容。
- Sidebar 与 Chrome 可以接近，但不应完全相同；侧栏通过更大的连续面积建立层级。
- Editor 可比 Content 更暗，表达输入和代码区域，但不能形成厚重卡片。
- Menu、Popover、Dialog 使用更亮的 Elevated Surface，并配合边界和阴影分离。
- 不使用绿色、黄色或褐色倾向的深灰。
- 不通过增加更多深灰色阶解决层级问题。

## 4. 交互覆盖层

| 状态 | 建议值 |
|---|---:|
| `--interaction-hover` | `rgba(255, 255, 255, 0.05)` |
| `--interaction-selected` | `rgba(255, 255, 255, 0.09)` |
| `--interaction-pressed` | `rgba(255, 255, 255, 0.13)` |
| `--focus-soft` | `rgba(255, 255, 255, 0.18)` |

- 交互覆盖层必须在 Sidebar、Chrome 和 Content 上保持近似感知强度。
- Selected 不使用不透明浅灰，以免降低文字和状态色对比。
- Hover、Selected、Pressed 的强度顺序与浅色一致。
- Focus 比 Hover 更清晰，键盘导航不能依赖 Hover 表达。

## 5. 文字与边界

| 语义 | 建议值 |
|---|---:|
| `--text-primary` | `#f1f1f3` |
| `--text-secondary` | `#b8bac0` |
| `--text-muted` | `#858890` |
| `--text-disabled` | `#60636a` |
| `--separator` | `rgba(255, 255, 255, 0.08)` |
| `--separator-strong` | `rgba(255, 255, 255, 0.14)` |
| `--primary` | `#f0f0f2` |
| `--primary-hover` | `#ffffff` |
| `--primary-foreground` | `#202124` |

- 大面积正文不使用纯白 `#ffffff`，减少刺眼感。
- Muted 文字不能承载错误、警告、快捷操作和必需说明。
- 普通正文以 4.5:1 为最低目标；图标和必要边界以 3:1 为最低目标。
- 暗色浮层主要依赖 `Separator + Shadow`，不能只依赖黑色阴影。

## 6. 状态色与 BSON 数据色

暗色数据色需要提高明度并降低一点饱和度，避免荧光感：

| 语义 | 建议值 |
|---|---:|
| Success / String | `#67c78f` |
| Warning | `#d59a52` |
| Error | `#ff7b72` |
| Number / Date | `#79a7ff` |
| Boolean / Regex | `#c5a0f0` |
| ObjectId / Binary / Special | `#ff9b73` |
| Null | `#777b83` |

- Tree、Table、JSON、Console 和 CodeMirror 使用相同语义映射。
- 类型色只出现在数据和代码中，不扩散到大面积 UI Chrome。
- Error/Warning 背景使用对应颜色的 10%–13% 透明层。
- 连接状态除了颜色，还必须保留状态语义和可访问标签。
- 实施时逐项检查真实字体与字号下的对比，不以 Token 表格替代视觉测试。

## 7. Query 与 Result Tabs

- 标签栏使用 `--surface-chrome`。
- 活动标签使用 `--surface-content`，必须与下方工作区或结果区完全同色。
- 活动标签不加外阴影，不用发光描边。
- 非活动标签之间使用 `--separator-strong` 的短竖线。
- 活动标签及左右相邻位置隐藏竖线。
- Hover 叠加 `--interaction-hover`，Close Hover 叠加 `--interaction-selected`。
- Spinner、失败 Dot 和 Close 槽位保持固定，避免 Tab 宽度跳动。
- 水平滚动、纵向 Query 选择器和活动标签定位行为与浅色一致。

## 8. Tree / JSON / Table 分段控件

该区域保持独立边界和固定布局：

- 底座使用 `--surface-control`。
- 外边界使用 `--separator-strong`。
- 活动模式使用约 14% 的白色透明层和主要文字。
- 不建议使用纯白活动块；它会在暗色工具栏中形成过强闪光。
- 右侧 Meta、Pagination、Copy、Expand 和未来操作按钮保持现有布局。

## 9. 侧栏与目录树

- Sidebar 使用单一 `--surface-sidebar`，不加外阴影。
- 区块之间优先用留白，不重新加入大量 Hairline。
- Hover/Selected 使用透明白色覆盖层。
- Sticky Connection Row 在技术上需要不透明合成以遮挡滚动内容，但最终感知强度必须与普通 Selected 一致。
- Status Dot 可使用轻 Halo；连接中的 Ping 在 Reduced Motion 下关闭。
- 搜索框使用 Control Surface，Focus 时增强边界和软 Focus Ring。

## 10. 编辑器与数据区域

- CodeMirror 使用 `--surface-inset` 对应的独立 Hex 值。
- 工作区与结果区使用 `--surface-content`。
- 表格表头可使用稍亮的 Control Surface；正文不使用斑马纹，Hover 使用透明覆盖层。
- 表格默认只使用横向 Hairline。
- Tree、Table 的选择状态与普通目录选择使用同一强度体系，但保留各自的数据选择语义。
- 不因暗色主题更改虚拟化、分页、复制和内联编辑行为。

## 11. 表单与 Modal

- Modal 使用 Elevated Surface、单层外边界和 Dialog Shadow。
- Backdrop 建议使用 `rgba(0, 0, 0, 0.55)`；可保留小幅模糊，但不能依靠重模糊隐藏背景结构。
- Input、Select、Textarea 使用 Control Surface，静止边界较弱。
- Focus 使用浅灰边界和 `--focus-soft`，不能删除焦点环。
- Field Group 使用标题和间距，不增加深灰卡片。
- Hosts、Options 等结构列表只保留一个外层结构边界。
- Primary Button 可以使用浅灰白底和深色文字；普通工具按钮保持透明。

## 12. 暗色阴影

暗色背景上黑色阴影不够独立，因此必须配合浅色透明边界：

```css
--shadow-popover:
  0 14px 40px rgba(0, 0, 0, 0.46),
  0 2px 10px rgba(0, 0, 0, 0.28);

--shadow-dialog:
  0 30px 80px rgba(0, 0, 0, 0.62),
  0 6px 20px rgba(0, 0, 0, 0.36);
```

- Popover、Menu、Select Popup、Tooltip、Toast 使用 `--shadow-popover` 和 10% 左右浅色边界。
- Dialog、Modal 使用 `--shadow-dialog` 和 12% 左右浅色边界。
- 常驻表面没有外阴影。
- 禁止白色 Glow、彩色 Glow 和选中 Tab Glow。
- Focus Ring、Inset Selection 和 Status Halo 使用独立 Token。

## 13. 动画

暗黑模式不定义专属动画：

- 使用与浅色相同的 `120ms / 180ms / 220ms` 时间和缓动。
- Tab 切换不移动、不弹跳，活动表面接近即时切换。
- 不给主题切换添加全局颜色渐变；直接更新 Token，避免整页闪动和持续重绘。
- Menu、Popover 和 Toast 可以做短 Fade/Translate。
- Reduced Motion 下关闭非必要位移、缩放、Ping 和平滑滚动。
- Busy 状态必须同时有文字或静态图标语义，不能只依赖旋转。

## 14. 实现策略

暗色实现应主要集中在 `tokens.css`：

```css
[data-theme='dark'] {
  /* 只覆盖 surface / interaction / text / separator / primary / status / data / shadow */
}
```

- 结构 CSS 与浅色共用，不为暗色复制 Query Tab、Result Tab、Sidebar 或 Form 布局。
- 业务组件不添加 `theme === 'dark'` 分支。
- 少数无法读取 CSS Variable 的位置（如 CodeMirror Theme）同步独立 Hex。
- `system` 主题继续由现有 `data-theme` 流程驱动，不新增主题状态源。
- 实施浅色语义 Token 时就为暗色映射当前值，保证功能不退化；暗色视觉精调可以在浅色验收后进行。

## 15. 验收清单

- Chrome、Sidebar、Content、Inset、Elevated 五个层级在暗色中可辨识。
- 不存在绿褐色大面积背景，也不使用纯黑主背景。
- Query/Result 活动标签与下方表面连续，竖线规则与浅色一致。
- Tree / JSON / Table 分段控件保持固定边界和右侧扩展空间。
- Primary、Hover、Selected、Pressed 和 Focus 均可区分。
- 正文、Muted、Disabled、状态色和 BSON 类型色通过对比检查。
- Menu、Tooltip、Select、Toast、Modal 的边界和阴影层级清楚。
- 低亮度显示器下不丢失边界，高亮度/OLED 下不出现大面积刺眼纯白。
- System / Light / Dark 切换不产生布局位移和全局动画闪烁。
- Reduced Motion 行为有效。
- Electron 中人工检查主界面、多标签、结果区、连接弹窗、菜单、Tooltip、错误和 Loading 状态。
