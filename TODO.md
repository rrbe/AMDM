# TODO — 后续可做项（路线图）

> 更新于 2026-06-04。本文件是**经代码核对后**的 backlog，用来取代/刷新 `SPEC.md` §4 里那份已部分过时的遗留清单（见末尾「已纠正」）。
> 标签含义：`[难度]` = 编码与设计复杂度；`[风险]` = 出错/回归影响面（尤其是否动到有测试的 shell 核心或主进程）。

## P1 — 近期高价值（最常被硌到 / 真实功能缺口）

### 1. 结果翻页 / 加载更多　✅ 已完成（2026-06-04）
`FindCursor` 支持上一页/下一页（引擎注入 `skip`，`ShellResult.pageable` 标志），结果栏右侧出现翻页器 + 范围 `51–100`；聚合/脚本不可翻页时退化为调大每页条数。链路：`shellCore`（`skip` option + `pageable`）→ 类型/IPC → store（`resultSkip` + `loadPage`）→ `ResultPanel`。已补 3 个 shell 核心测试。

### 2. 查询结果条数上限可配置　✅ 已完成（2026-06-04）
`AppSettings.queryLimit`（默认 50，存量 settings.json 自动合并默认值）；结果栏「每页 [n]」控件，回车/失焦应用并从第一页重跑。`setQueryLimit` action。

### 3. 停止执行 / Stop Script　✅ 已完成（2026-06-04）
每次执行在渲染层生成 `execId` 随请求带上；主进程为它建 `AbortController` 注册进 `shellEngine` 的 `inFlight` registry，把 `signal` 注入 driver 的 `find`/`findOne`/`aggregate`/`runCommand`/`command` 主路径（v6.10 原生 `AbortSignal`，真正服务端取消游标/操作）。`await result`、explain、`drainCursor` 额外做 abort 竞速 / 关游标兜底，保证不识别 signal 的操作 UI 也能立即解锁；中断统一收敛为一个干净的 `kind:'error' / errorName:'Aborted'` 结果。新增 `shell:abort` IPC（→ `abortShell`）；工具栏 Run 运行时切换为「■ 停止」(danger)，右键菜单加「停止执行」(仅运行时可点)。
- 链路：`shellCore`（`signal` option + sandbox 注入 + drain 兜底）→ `shellEngine`（registry + `abortShell`）→ 类型/IPC/preload/registerIpc → store（`runningExecId` + `stopShell`）→ `ShellWorkspace`/`ShellEditor`。已补 5 个 shell 核心 abort 测试（cursor / aggregate / promise(count) / explain / 无回归）。
- 已知边界：`vm` 同步死循环（如 `while(true){}`）仍由 30s vm timeout 兜底，signal 无法中断不让出事件循环的同步代码——符合「先覆盖 find/aggregate 主路径」的范围。

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
