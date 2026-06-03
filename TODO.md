# TODO — 后续可做项（路线图）

> 更新于 2026-06-04。本文件是**经代码核对后**的 backlog，用来取代/刷新 `SPEC.md` §4 里那份已部分过时的遗留清单（见末尾「已纠正」）。
> 标签含义：`[难度]` = 编码与设计复杂度；`[风险]` = 出错/回归影响面（尤其是否动到有测试的 shell 核心或主进程）。

## P1 — 近期高价值（最常被硌到 / 真实功能缺口）

### 1. 结果翻页 / 加载更多　`[难度: 中] [风险: 中]`　← 已选定为下一步
现在结果只取前 50 条，UI 只显示一行灰字 `truncated — showing first 50`，想看后面得手动去编辑器改 `.skip().limit()`。对 NoSQLBooster 替代品这是最常见的限制。
- **设计要点（已核对 `shellCore.ts`）**：脚本完成值是个**惰性 cursor**，`drainCursor` 多取一条判断截断。翻页对返回的 `FindCursor` 注入 `.skip(offset)` 再 drain 即可——`FindCursor` 有 `.skip()`，但 `AggregationCursor` **没有**。
- **务实范围**：`FindCursor` → 真·上一页/下一页（重跑时注入 skip）；其余脚本（aggregate / 任意表达式）退化为「调大 limit 重取」。server 端在 `ShellResult` 多返回一个 `pageable` 标志，UI 据此决定是否显示翻页器。
- 触链路：`shellCore.runShellOnDb`(加 `skip` option) → `ShellRequest`/`ShellResult` 类型 → `ipc`/`preload`/`registerIpc` → `shellEngine` → store(`runShell` 记住分页态 + `loadPage`) → `ResultPanel` 页脚翻页器。
- 注意：动到**有测试的 shell 核心**，改完跑 `pnpm test`。

### 2. 查询结果条数上限可配置　`[难度: 低] [风险: 低]`
`DEFAULT_LIMIT = 50` 现在硬编码在 `shellCore.ts`。提升为 `AppSettings.queryLimit` + 编辑器头部可快速调整。与翻页天然配套，建议和 #1 一起做。

### 3. 停止执行 / Stop Script　`[难度: 中-高] [风险: 中]`
`abort/cancel` 全代码库搜不到——跑飞的 find/aggregate 无法中断，对「性能优先」的工具是真实痛点。
- 思路：执行时持有可取消句柄；优先用 driver 的 `AbortSignal`（近版本各操作支持）或 `maxTimeMS`；新增 `shell:abort` IPC 通道 + store action + 编辑器「停止」入口（右键菜单已留了 Stop Script 的位置）。
- 难点：`vm` 跑的是任意 JS，信号注入不通用；先覆盖 find/aggregate 主路径。

## P2 — 中期（体验 / 完整度）

### 4. Tooltip 统一　`[难度: 低] [风险: 低]`
现有 29 处用原生 `title=`（延迟、丑、不可定制、深色模式不统一）。做一个轻量样式化 tooltip 组件替换。顺便为「是否引组件库」验证第一个原语。

### 5. 多查询标签页　`[难度: 中-高] [风险: 中]`
现在是单编辑器 + 单结果。NoSQLBooster 支持多 tab。涉及 store 从「单 code/result」改为「tab 数组 + activeTab」，影响面较大。

### 6. 保存查询的文件夹 / 两级组织 UI　`[难度: 中] [风险: 低]`
SPEC §4 遗留。保存查询数量上来后需要分组/文件夹。

### 7. 连接配置导出 / 备份　`[难度: 中] [风险: 中]`
SPEC §4 遗留。导出连接配置以便迁移/备份——**密钥不导出**（在 Keychain，见 ADR-0006），导入后需重新输入密码。

### 8. Editor Settings　`[难度: 低-中] [风险: 低]`
右键菜单里当前置灰的那项。字号、自动换行、tab 宽度等编辑器偏好，落到 `AppSettings`，作用于 CodeMirror。

## P3 — 投资 / 按需（ROI 取决于你是否在意，不急）

### 9. 引 headless 组件库（Radix / Base UI）　`[难度: 中] [风险: 中]`
即之前讨论的「Phase 2」。收益主要是**键盘无障碍**：Modal 缺 focus trap、ContextMenu 缺方向键导航、真正的 Tooltip。对单人鼠标为主的桌面应用 ROI 一般。
- **触发条件（命中任一再做）**：① 开始想要键盘驱动流 / 在意 a11y；② 需要手写第 3 个复杂原语（已手写 Modal + ContextMenu，下次要带定位的 Popover/Combobox 时就是信号）；③ 手写 Modal/Menu 开始反复出 bug。
- 真要做就从小处起：先只迁 Modal → Dialog 或先做 Tooltip(#4)，验证 bundle 与手感再推进。

### 10. BSON 导入的目标命名空间重映射　`[难度: 中] [风险: 低]`
SPEC §4 遗留。`mongorestore` 包裹路径下，允许把源 ns 映射到目标 db/coll。窄场景。

### 11. 官方工具 mongodump / mongorestore 按需下载　`[难度: 中] [风险: 中]`
SPEC §4 遗留。BSON 导入导出依赖系统已装这俩工具；缺失时按需下载对应版本（见 ADR-0005）。属基础设施，仅在工具缺失时影响。

### 12. 聚合管道可视化构建器　`[难度: 高] [风险: 中]`
NoSQLBooster 招牌功能（分阶段搭 pipeline、逐级预览）。大件，需单独立项评估，不轻易开。

## 已纠正 / 已完成

- **表格内联单元格编辑** —— `SPEC.md` §4 把它列为遗留，但实际**已完成**：`TableView` 双击单元格 + `CellInput` + store `setDocumentField`，TreeView 也有节点级编辑。SPEC §4 该条已失效。
