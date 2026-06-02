# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供指引。

## 本项目协作规则（覆盖全局默认）

1. **优先使用中文**：回复、说明、commit 说明、文档一律中文（代码、标识符、配置值保留英文）。
2. **直接提交到 `master`**：本项目**不开分支、不走 PR**,直接提交到 `master`。但不要随意、细碎地提交——**一个功能做得差不多了再提交一次**,避免把一个功能拆成一堆零碎 commit。Commit message 仍遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` …）。

> 注意：以上第 2 条**有意覆盖**全局 CLAUDE.md 中"代码变更走新分支 + PR、不直接提交主分支"的默认规则——本项目是单人项目,以 `master` 直接提交为准。

## 这是什么

一个精简、**性能优先**的 MongoDB 桌面 GUI——个人版 NoSQLBooster 替代品（Electron + React + TypeScript + Vite,经 `electron-vite`）。性能是第一优先级,也是放弃 NoSQLBooster 的直接原因；见下方不可妥协的铁律。Phase 1–3 已完成。

改动前应先读的纲领文档：`SPEC.md`（范围）、`CONTEXT.md`（领域术语——务必沿用其中的精确用词）、`docs/adr/0001`–`0006`（已锁定的决策）。`SPEC.md` §4 列出了剩余待办。

## 常用命令

```bash
pnpm install      # 必须用 pnpm，不能用 npm/yarn（原因见下）
pnpm dev          # 启动应用 + 热重载（electron-vite dev）
pnpm typecheck    # 类型检查 main + renderer —— 这是唯一的校验闸门
pnpm build        # 生产构建到 ./out
pnpm start        # 预览已构建的应用（electron-vite preview）
```

- **没有测试框架,也没有配置 linter。** `pnpm typecheck`（先 `typecheck:node` 再 `typecheck:web`,分别对应两个 tsconfig）是唯一的自动化校验——改完务必跑一次。不要臆造 `pnpm test` / `pnpm lint`。
- **必须用 pnpm。** `.npmrc` 设了 `node-linker=hoisted`（Electron 不喜欢 pnpm 的软链接隔离布局）,且 `package.json#pnpm.onlyBuiltDependencies` 放行了 `electron`+`esbuild`,否则它们的二进制装不全——pnpm v10 默认拦截依赖的构建脚本。新增需要原生/下载二进制的依赖时,也要加进这里。

## 进程架构

三套源码、三套构建产物（`electron.vite.config.ts`）、三个路径别名——`@shared`、`@renderer`,`main` 内部走相对引用：

- **`src/main/`** —— Electron 主进程（Node）。掌管所有特权操作：MongoClient 连接、SSH 隧道、`vm` shell 沙箱、JSON 配置存储、Keychain 密钥、序列化 worker。
- **`src/preload/`** —— 上下文隔离的桥接层。只暴露一个带类型的 `window.api`（`contextBridge`）；渲染进程**碰不到**其它任何东西（没有 Node,没有 `ipcRenderer`）。
- **`src/renderer/`** —— React UI。所有后端访问都经由 `window.api`,绝不直接触碰 Node。
- **`src/shared/`** —— IPC 契约（`ipc.ts` = 通道名 + `Api` 接口；`types.ts` = 线传类型）,三端共同引用。**这是核心接缝：改动任何 IPC 行为,都要同步、连带地修改 `ipc.ts`、`preload/index.ts`、`main/ipc/registerIpc.ts` 和渲染进程的 store。**

任意功能的数据流：`useAppStore` 里的 action → `window.api.x.y()` → preload 的 `invoke` → `registerIpc` 的 handler → 某个 `main/` 模块 → 原路返回。新增一个 IPC 调用,要动这四个文件 + `shared/types.ts` 里的类型。

## 跨文件的关键机制（需读多个文件才能理解）

### Shell-on-driver（ADR-0003）
`main/mongo/shellEngine.ts` 在 Node `vm` 沙箱里执行用户的 JS,其中 `db` 是官方 driver `Db` 上的 `Proxy`：`db.<任意名>` 解析为真实的 `Collection`(所以 `db.lives.find()` 能用),真正的 `Db` 方法直接透传,`getSiblingDB`/`getCollection` 与 EJSON 构造器（`ObjectId`、`ISODate`、`NumberLong`…）则做了 shim。我们**有意只实现 shell API 的一个子集**——缺失的应当报错,绝不静默错。脚本的最后一个表达式的求值结果即为返回值（REPL 语义）；游标按有界页拉取（`DEFAULT_LIMIT = 50`,多取一条用于判断是否被截断）。绝不把整个集合塞进内存。

### 序列化下沉到 worker + 内联降级（ADR-0004 第 3、4 条）
`main/workers/serializerPool.ts` 是单个常驻 worker（`serializer.worker.ts`,作为**独立的 rollup input** 构建为 `out/main/serializer.worker.js`）的主线程客户端。主线程只做开销小的二进制 `BSON.serialize`；worker 做昂贵的 EJSON 编码 + 字段提取。**关键健壮性契约：** worker 起不来或崩溃时,池会透明地降级为内联执行**同一份** core 帮助函数（`serialize-core.ts`）——绝不能因 worker 抖动而白屏或卡死。改动池时,务必保住这套降级逻辑和那条 "no transferList" 注释（转移 BSON buffer 可能误伤 Node 的共享分配池）。退出时（`will-quit`）销毁。

### EJSON-canonical 线格式（main↔renderer 的数据契约）
后端把所有 BSON 结果序列化为 **EJSON-canonical 纯对象**（`{ "$oid": … }`、`{ "$date": … }`、`{ "$numberLong": … }` 等）。`renderer/src/lib/ejson.ts` 是**唯一**懂这套形状的地方——由它决定显示字符串、类型标签,以及（最关键的）Tree/Table/JSON 视图里哪些节点可展开。新增任何 BSON 类型支持,都要同时改序列化 core 和 `ejson.ts`。

### 渲染进程状态 —— Zustand v5,**必须返回稳定引用**
`renderer/src/store/useAppStore.ts` 是唯一真相源；所有 `window.api` 调用都在这里,每个异步 action 都 catch 错误并以 `lastError` 呈现,而非把异常抛进 UI。**会导致白屏的坑：** Zustand v5 的 selector 必须返回稳定引用。store 里持有 `Set`（`expanded`、`loading`、`expandedConnections`）和嵌套 `Record`——在 `set()` 里务必新建 Set/对象（参考已有的不可变更新写法）,也绝不要在 selector 里返回未 memo 的全新对象/数组字面量。目录树按节点**懒加载**（collections/indexes/users 仅在展开时拉取）,断开连接时销毁（ADR-0004 第 6 条）。

### 密钥与持久化（ADR-0006）
应用状态以纯 JSON 存于 Electron `userData`：`connections.json`、`queries.json`（保存的查询 + 有上限的历史）、`settings.json`——不用 SQLite（避免原生模块重编译的折腾）。存储模块在 `main/store/`。密钥（密码、SSH passphrase）**绝不**以明文落入这些文件,**绝不**跨 IPC：`connectionStore` 用 Electron `safeStorage`（macOS Keychain）加密；渲染进程只看到 `hasPassword` 之类的布尔标志。解密只在连接时、在 `main/` 内部发生。

## 性能铁律（ADR-0004 —— 不可妥协,每个功能都必须遵守）

1. 所有大列表/树/表格一律虚拟化（`@tanstack/react-virtual`）；DOM 只持有可见行。
2. 游标流式拉取,在数据层就分页限界——绝不把整库塞进渲染进程。
3. 重 CPU（BSON↔EJSON、格式化、schema 采样）丢到主线程之外 → 序列化 worker。
4. schema/字段采样:懒、有界（~50 文档）、异步、缓存（`main/mongo/catalog.ts` 的 `sampleFields`）。
5. **打开集合不自动查询**——浏览集合只会把 `db.coll.find({})` 填进编辑器,绝不执行。加载保存的查询/历史同理。
6. 关闭 tab/连接时积极销毁；退出时清理所有 client、SSH 隧道和 worker（`main/index.ts` 的 `will-quit`）。
7. 保持 Electron 版本新、原生 arm64,重功能懒加载（CodeMirror 6 即为懒加载）。
