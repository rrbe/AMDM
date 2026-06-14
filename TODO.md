# TODO — 后续可做项（路线图）

> 更新于 2026-06-14。本文件是**经代码核对后**的 backlog，用来取代/刷新 `SPEC.md` §4 里那份已部分过时的遗留清单（见末尾「已纠正」）。
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

### 4. Tooltip 统一　✅ 已完成（2026-06-04）
全局委托式 `TooltipLayer`（挂 App 根，监听 `mouseover`/`mouseout`，读元素 `data-tip` 属性，延迟 350ms，portal 到 `<body>` 避免裁剪，测量后夹取视口内定位，主题变量配色 z 3000）。采用方式即把 `title=` 改名为 `data-tip=`——共替换 30 处（排除 5 处其实是 `<Modal title>` 组件 prop），icon-only 按钮补 `aria-label` 防 a11y 回归。`Button` 新增 `'data-tip'?` prop 转发。这是「是否引组件库」验证的第一个手写原语。

### 5. 多查询标签页　✅ 已完成（2026-06-04）
store 从「单 code/result」改为 `tabs: QueryTab[]` + `activeTabId`；每个 tab 自带 code/result/activeDatabase/lastQuery/resultSkip/running/runningExecId，独立运行（一个 tab 跑查询时另一个可编辑/也可并发跑）。**异步运行按发起时的 tabId 回填**，切 tab 或并发跑都不串。`resultView`(Tree/JSON/Table) 仍为全局偏好。纯逻辑（`createTab`/`patchTab` 保持未改 tab 的引用稳定→规避 zustand 白屏雷区 / `pickActiveAfterClose` / `tabLabel`）抽到 `lib/tabs.ts` 并配 11 个单测。组件统一经 `getActiveTab(s)` selector 读活动 tab（返回基元或已存引用，引用稳定）。UI：顶部 tab 条（标签取目标集合名、运行小圆点、关闭 ✕、`+` 新建、⌘T、中键关闭），编辑器 `key={activeTabId}` 隔离各 tab 的 undo 历史。
- 已 Playwright 真机验证：连真实 mongod → tab 条出现、`+` 建 tab、切 tab、关 tab 全部正确，无白屏（连 main↔renderer 全链路）。

### 6. 保存查询的文件夹 / 两级组织 UI　✅ 已完成（2026-06-04）
`SavedQuery`/`SavedQueryInput` 加可选 `folder` 字段（空=未分组，`queryStore` trim 落盘，存量自动兼容）。保存弹窗加 Folder 输入框 + `<datalist>` 列出已有文件夹（输入新名即建新文件夹）。`SavedQueriesPanel` 的 Saved 子页按文件夹分组（文件夹 A→Z、「未分组」垫底）、可折叠（本地状态），全部未分组时退化为旧的扁平列表。行右键菜单：加载 / 移动到「X」/ 移出文件夹 / 删除——移动复用 `saveQuery(id=…)` 原地改 folder。

### 7. 连接配置导出 / 备份　✅ 已完成（2026-06-04）
导出全部连接为 JSON 备份、从备份恢复——**密钥不导出**（在 Keychain，ADR-0006；`ConnectionConfig` 本就只含 `hasPassword` 指示位，无明文），导入后需重新输入密码/SSH 口令。导入**总是分配新 id**（恢复只新增，绝不覆盖现有连接）。纯逻辑（`buildBackup`/`parseBackupConnections`：跳过非法项、剥离任何混入的密钥字段、兼容 wrapper 或裸数组）抽到 `connectionBackupCore.ts` 并配 7 个单测；effectful 壳 `connectionBackup.ts` 管原生对话框/fs/store。链路：core+壳 → IPC（`connections:export`/`import`）→ preload/registerIpc → store（`exportConnections`/`importConnections`）→ Connections 头部「⋮」菜单。

### 8. Editor Settings　✅ 已完成（2026-06-04）
编辑器偏好落到 `AppSettings`（`editorFontSize`/`editorWordWrap`/`editorTabSize`，默认 13 / false / 2，存量 settings.json 自动合并默认值），作用于 CodeMirror：字号经 `EditorView.theme` 注入、tab 宽度经 `EditorState.tabSize`+`indentUnit` facet、自动换行经 `EditorView.lineWrapping`。入口沿用本项目「就地上下文控件」的设计语言——编辑器右键菜单新增「自动换行：开/关」「Tab 宽度：n」(循环) 「增大/减小字号」，外加键位 ⌘+/⌘−/⌘0（`preventDefault` 压掉 Electron 窗口缩放）。注：SPEC/TODO 说的「右键菜单置灰项」是过时记述，实际并无该项。
- 链路：`types`（AppSettings+默认值）→ `ShellEditor`（selector 读偏好 + extensions 注入 + 键位/菜单）。无新增 `lib/`/`*Core` 纯函数，故按约定不配单测（与 theme/editorHeight 一致）。

## P3 — 投资 / 按需（ROI 取决于你是否在意，不急）

### 9. 引 headless 组件库（Base UI）　✅ 已完成（2026-06）
全量迁到 `@base-ui/react`：`components/ui/` 下沉九个原语（Dialog/Menu/Tabs/Field/Input/Select/Checkbox/NumberField/Tooltip）；旧 `Modal`/`ContextMenu` 内部重写到 Dialog/Menu、对外 API 不变；连接表单/设置/保存查询表单全部迁完，删死 CSS 并补 `DESIGN.md`。链路见 commit `5e21f35`→`2f9fb08` + PR #1–#6。

### 10. ~~BSON 导入的目标命名空间重映射~~　❌ 已失效（2026-06-14）
原是 `mongorestore --archive` 路径下的源→目标 ns 重映射。BSON 改为**原生 plain `.bson`**（见 #11）后无内嵌命名空间，导入直接写进用户选的 db/coll，此需求自动消失。

### 11. ~~官方工具 mongodump / mongorestore 按需下载~~ → **原生 BSON 导入导出**　✅ 已完成（2026-06-14）
权衡后**砍掉对 mongodump/mongorestore 的依赖**（内置会 +18MB/平台并引入 macOS 签名/公证成本；按需下载逻辑最重）。改为**进程内原生处理 plain `.bson`**（mongodump 目录模式同款格式：长度前缀 BSON 文档首尾相接，与真·mongodump/mongorestore 双向互通），`bson` 包本就是依赖。
- 导出：游标流式 `BSON.serialize` 写盘，可选 gzip（`.bson.gz`），内存有界。
- 导入：读文件→gzip 自动探测/解压→逐文档解析（`promoteValues:false` 保数值子类型保真）→批量 insert，写进用户选的目标集合。
- 纯编解码逻辑落 `bsonFileCore.ts` + 7 个单测；导入写路径 2 个集成测试（真 mongod，断言 ObjectId/Int32/Long/Decimal128/Binary/Date 保真 + gzip）。`tools.ts`/`connArgs.ts`/`tools:status` IPC/`ToolStatus`/各 Modal 的工具置灰逻辑全部删除——净减代码。

### 12. 聚合管道可视化构建器　`[难度: 高] [风险: 中]`
NoSQLBooster 招牌功能（分阶段搭 pipeline、逐级预览）。大件，需单独立项评估，不轻易开。
- 已做架构调研（2026-06-14）：执行/结果/字段采样链路均可复用（`runShellOnDb` 任意 pipeline、三视图对数据来源无感、`catalog.sampleFields` 现成缓存、`shell:execute` 通道够用），无需改 shell 引擎。最自然落点是**编辑器旁挂可折叠侧面板 + 生成 JS code 回填编辑器**（不新增 tab 类型，复用现有 `QueryTab` 与执行链路）。主要风险：聚合游标不可分页（需隐藏翻页器）、逐阶段预览的执行频率（仅手动「预览」时跑）、生成代码的 BSON-safe 正确性。

## 已纠正 / 已完成

- **表格内联单元格编辑** —— `SPEC.md` §4 把它列为遗留，但实际**已完成**：`TableView` 双击单元格 + `CellInput` + store `setDocumentField`，TreeView 也有节点级编辑。SPEC §4 该条已失效。
