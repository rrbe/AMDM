# TODO — 待办 backlog（live）

> 更新于 2026-06-17。本文件**只列尚未做的事**；已交付功能见 git 历史 / PR / `SPEC.md`。
> 标签：`[难度]` = 编码与设计复杂度；`[风险]` = 回归影响面（尤其是否动到有测试的 shell 核心 / 主进程）。

**现状**：`SPEC.md` §2 的功能范围已基本交付完（连接管理 / 浏览 / Shell / 补全 / 保存查询+文件夹 / 导入导出含原生 BSON / 三视图 / explain 可视化 / 文档·单元格编辑 / 多 tab / i18n / 集中设置 / 聚合管道构建器）。剩下的是**性能加固与健壮性**两个缺口，都不紧急。

---

## 1. 侧边栏目录树虚拟化 vs sticky 段头　`[难度: 高] [风险: 中]`

目录树（`components/explorer/Explorer.tsx`）仍是 `rows.map()` 直渲、**未虚拟化**，与性能铁律 #1（所有大列表/树一律虚拟化）有差距。难点是连接行的 **sticky 段头**（`styles/explorer.css` 的 `.conn-item`，`position: sticky; top: 0`）结构上依赖真实 DOM 流，虚拟化常用的绝对定位容器会让 sticky 失效——二者不可简单叠加，需同步用 `@tanstack/react-virtual` 的 sticky-index 方案重设计段头。
- 实际触发阈值高：单连接集合数极多时才会卡，个人日常通常无感，故不紧急。
- 结果三视图（Tree/Table/Json/Console）均已虚拟化，本项是唯一缺口。
- 注：#10「侧边栏精修」做了 sticky 滚动与右键菜单，但**未**碰虚拟化，张力依旧。

## 2. 导入侧增量解析（流式、有界内存）　`[难度: 中] [风险: 低]`

导出已流式有界，但导入仍是「整个文件 `readFileSync` + 全部文档一次进内存再分批 insert」（`bsonFileCore` 及各格式导入路径）。.bson / JSON 上 GB 时会顶内存。理想形态：边解析 buffer 边按 1000 批量插（批量 insert 逻辑已有，缺的是流式读）。与既有 JSON/CSV/XLSX 导入同形状，非回归，优先级低。

## 3. SSH 隧道增强（PR #14 之后的后续）　`[难度: 中–高] [风险: 中]`

PR #14（`feat/ssh-agent-auth`，待合并）已实现:主机密钥 TOFU 校验（静默，无 UI，仅首连学习、变更即拒）/ 跳板机（**单跳** ProxyJump，ssh2 嵌套连接，私钥认证）/ `~` 展开与并发隧道句柄竞态修复 / SSH 表单校验 / 连接前 TCP 预检 / 逐跳连通性检测（Check connectivity，SSH 主机与跳板机各自检测、结果默认折叠）/ 副本集+隧道告警 / 私钥友好报错 + 文件选择器。**SSH 认证仅密码 + 私钥两种（ssh-agent 已移除）。** 隧道核心已拆为 `main/ssh/tunnelCore.ts`（纯函数，有单测）+ `tunnel.ts`（ssh2 副作用）。以下为**尚未做**的:

- **运行期 SSH 掉线上报**　`[难度: 中] [风险: 中–高]` —— 隧道在 `ready` 之后掉线不翻状态，`getStatus` 仍报 connected（“假在线”），查询被 30s `serverSelectionTimeout` 拖死。根因:`tunnel.ts` 仅 open 期监听 client error、resolve 后无 close/error 处理；`sessionManager` 不挂运行期监听。**卡点是架构**——本仓目前纯拉取式 IPC，全仓 0 处 `webContents.send`，要把“隧道断→状态 error”推给渲染层需新增一条**单向推送通道**（动 `shared/ipc.ts` + `preload` + `registerIpc` + store 订阅），这条通道也是未来一切实时状态推送的地基。**价值最高的下一步。**
- **多跳跳板链**　`[难度: 中] [风险: 低]` —— 现仅支持单跳 `SshConfig.jump`。多跳需把 jump 改为链（数组或递归）并在 `tunnel.ts` 顺序嵌套 `connectHop`/`forwardOut`。
- **跳板机密码认证**　`[难度: 中] [风险: 中]` —— 当前跳板机仅私钥文件认证（带口令私钥已支持，走 `encJumpSshPassphrase`）。要支持跳板机密码，需扩 `connectionStore` 的密钥模型（加 `encJumpSshPassword`）+ ConnectionInput/sanitize/表单。
- **私钥粘贴内容（textarea）**　`[难度: 低–中] [风险: 低]` —— 文件选择器（`dialog:openFile` IPC + 「浏览…」按钮）已实现;尚缺 textarea 直接粘贴私钥内容（走 safeStorage 加密），供不便提供文件路径的场景。
- **连接总超时 + 取消**　`[难度: 低] [风险: 低]` —— 隧道 20s + mongo 30s 串行最坏 ~50s，renderer 停在 'connecting' 无取消入口。加统一 deadline（`Promise.race` + AbortSignal）+ 取消按钮（参考 `shellEngine` 的 abort 模式）。
- **隧道 / 驱动自动重连**　`[难度: 中] [风险: 中]` —— 断线后有限次自动重建隧道 + 重连（依赖上面的掉线事件机制）。

---

## 已交付（归档，详情见 git / PR）

- **P1**：结果翻页 / 每页条数可配 / 停止执行（原生 `AbortSignal` 取消游标）。
- **P2**：Tooltip 委托层（`data-tip`）/ 多查询 tab / 保存查询文件夹 / 连接配置导出备份 / Editor Settings。
- **P3**：Base UI 九原语迁移（PR #1–#6）/ 原生 BSON 导入导出、去除 mongodump 依赖（#7）/ explain 图形阶段树（#8）/ 聚合管道可视化构建器（#9）/ 侧边栏精修（#10）/ 全局样式拆分为分区文件 + 引入 CSS Module（管道构建器为首个范本）。

> 已失效（不再做）：BSON 导入的目标命名空间重映射（改原生 plain `.bson` 后无内嵌 ns，需求消失）；mongodump/mongorestore 按需下载（已砍掉对官方工具的依赖）。
