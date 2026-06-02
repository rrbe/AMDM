# Mongo Shell GUI — 规格书 (SPEC)

一个精简、性能优先的 MongoDB 桌面 GUI,作为 NoSQLBooster 的个人替代品:保留它最好的 UX(三种结果视图),砍掉让它卡顿的臃肿。**性能是第一优先级。** 所有代码由 AI agent 编写,用户不审阅代码,因此技术选型偏向"agent 最不容易写错、生态最成熟"的方案。

> 术语见 [CONTEXT.md](./CONTEXT.md);关键决策见 [docs/adr/](./docs/adr/)。

---

## 1. 技术栈(已锁定)

| 层 | 选择 | ADR |
|---|---|---|
| 平台 | macOS 优先,Web UI 技术栈(跨平台留后路) | — |
| 应用框架 | **Electron(精简版)** | [0001](./docs/adr/0001-build-on-electron.md) |
| 前端 | **React + TypeScript + Vite** | [0002](./docs/adr/0002-react-because-code-is-agent-written.md) |
| 数据访问 | 官方 **MongoDB Node.js 驱动** | [0003](./docs/adr/0003-shell-reimplemented-on-node-driver.md) |
| Shell 执行 | 在驱动之上重写 shell API,Node `vm` 沙箱,返回 typed BSON | [0003](./docs/adr/0003-shell-reimplemented-on-node-driver.md) |
| 代码编辑器 | **CodeMirror 6**(懒加载) | [0004](./docs/adr/0004-performance-first-architecture.md) |
| 结果渲染 | 全部 **虚拟化**(`@tanstack/virtual`) | [0004](./docs/adr/0004-performance-first-architecture.md) |
| 重活(序列化/采样) | **Worker 线程** | [0004](./docs/adr/0004-performance-first-architecture.md) |
| 导入导出 | JSON/CSV/XLSX 原生;BSON 包裹官方工具(按需下载,不内置) | [0005](./docs/adr/0005-import-export-strategy.md) |
| 秘钥存储 | **macOS Keychain**;非敏感配置存本地 JSON | — |

---

## 2. 功能范围(逐条对应你的需求)

### #1 连接管理
- 保存/编辑连接;**按颜色分组**(颜色挂在 Connection Group 上,不在单个连接上)。
- 认证/接入:**SCRAM(用户名密码)**、**SSH 隧道**(密码或私钥)、**TLS/SSL(含自签 CA / 客户端证书)**、**Replica Set / `mongodb+srv`(Atlas)**。
- **不做** 企业认证(x.509 / LDAP / AWS IAM / Kerberos)。
- 密码进 Keychain;其余配置本地 JSON,可导出/备份连接配置。

### #2 浏览
- 侧边栏:databases → collections → indexes / users,**懒加载**。
- **点击集合不自动执行查询**(ADR-0004 第 5 条),先显示元信息。

### #3 Shell 执行
- 用户输入 JS(如 `db.lives.find({...})`),在 `vm` 沙箱中执行,`db` 是驱动 shim,返回 **typed BSON**。
- 实现常用 shell API 子集(find/aggregate/count/distinct/index 操作等),按需增量补充;未支持的提示"unsupported helper"而非静默错。
- 批量/循环操作引导走服务端 aggregation / `bulkWrite`,避免客户端逐条往返。

### #4 代码补全
- CodeMirror 6 补全源:JS/shell API 关键字 + 驱动方法 + 当前库集合名 + **懒采样**得到的字段名(有界、缓存、Worker 中采样)。
- 不上重型 TS 语言服务(保持轻量)。

### #5 保存查询
- 两级:按连接 + 全局;文件夹组织。
- 另有**自动执行历史**(最近查询),与显式保存的查询分开。
- 本地 JSON 存储。

### #6 导入 / 导出(双向)
- **JSON/EJSON、CSV、XLSX**:原生 JS 进程内流式读写,复用现有连接(含 SSH 隧道),无外部二进制。
- **BSON**:包裹官方 `mongodump`/`mongorestore`;自动探测系统已装工具,没有则按需下载对应版本缓存,**不内置进安装包**。SSH 隧道时指向本地转发端口。

### #7 结果视图(照抄 NoSQLBooster)
- **Tree**:虚拟化,嵌套懒展开。
- **JSON**:EJSON,折叠/展开。
- **Table**:嵌套字段拍平成列,虚拟化,列显隐。
- 三视图可切换,布局 1:1 对齐 NoSQLBooster。

### #8 Explain / 高级分析
- **可视化摘要 + 原始 JSON 双视图**:解析 `executionStats` → winning plan 阶段树、`nReturned`/`totalDocsExamined`/`totalKeysExamined`、用了哪个索引、执行耗时、**COLLSCAN 红色告警**;原始 JSON 可展开。

### 数据编辑(范围决策)
- **文档级编辑**:双击文档打开 JSON 编辑器,改完保存。
- **删除文档**。
- **不做**表格内联单元格编辑(后续可加)。

---

## 3. 性能铁律(不可妥协 — 详见 [ADR-0004](./docs/adr/0004-performance-first-architecture.md))

1. 所有大列表/树/表格一律虚拟化,DOM 只持有可见行。
2. 游标流式分页拉取,默认页 50–100,绝不把整库塞进渲染进程。
3. 重 CPU(BSON↔EJSON、格式化、schema 采样)丢 Worker,绝不堵主线程。
4. schema 采样:懒、有界(20–100 文档)、异步、缓存。
5. 打开集合不自动查询。
6. 关闭 tab/连接立即销毁编辑器 model 和结果缓存;退出时清理所有子进程。
7. 用当前版 Electron + 原生 arm64 构建;懒加载重功能,tree-shake。

---

## 4. 分期计划

- **Phase 1(核心闭环,能日常用)** ✅ 已确认优先
  连接管理(SCRAM/SSH/TLS/replica)+ 浏览 db/coll/index/user + Shell 跑 find/aggregate + 三视图(虚拟化)。
- **Phase 2** ✅ 已完成
  代码补全 + 保存查询/历史 + explain 可视化 + 文档编辑/删除。
- **Phase 3** ✅ 已完成
  导入导出(JSON/CSV/XLSX 原生 + BSON 包裹官方 mongodump/mongorestore,见 ADR-0005)。
  入口:目录树集合节点 hover 的 Export/Import 按钮 → 弹窗选格式/过滤/limit。
  (连接颜色已改为每连接直选,Group 概念移除,见 CONTEXT.md。)

- **性能加固** ✅ 已完成
  序列化(BSON→EJSON 编码)与 schema 字段采样提取已挪到主进程的 **worker_thread 序列化池**(`src/main/workers/`),不再堵主进程事件循环(ADR-0004 第 3、4 条)。主线程只做很快的二进制 `BSON.serialize`,重活在 worker 里;worker 起不来或崩溃时自动**内联降级**,保证不影响功能。退出时随会话清理。
  遗留待办:官方工具(mongodump/mongorestore)的按需下载;BSON 导入的目标命名空间重映射;表格内联单元格编辑;连接配置导出/备份;保存查询的文件夹/两级组织 UI。
