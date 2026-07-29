# AGENTS.md

本文件为 coding agent 在本仓库工作时提供指引。

## 本项目协作规则（覆盖全局默认）

1. **优先使用中文**：回复、说明、commit 说明、文档一律中文（代码、标识符、配置值保留英文）。
2. **提交需要用户授权**：只有用户主动、明确要求 commit 时才提交；未被要求时只保留工作区变更。即使已获授权，也不要把一个功能拆成一堆细碎 commit。
3. **使用 Conventional Commits**：commit 信息格式为 `<type>: <summary>`，type 使用 `feat`、`fix`、`chore`、`refactor`、`docs`、`test`、`perf`、`style` 等常见前缀。
4. **直接提交到 `master`**：功能改动不创建功能分支、不走 PR；用户要求提交时直接提交到 `master`。

## 这是什么

一个精简、**性能优先**的 MongoDB 桌面 GUI——个人版 NoSQLBooster 替代品（Electron + React + TypeScript + Vite,经 `electron-vite`）。性能是第一优先级,也是放弃 NoSQLBooster 的直接原因；见下方不可妥协的铁律。Phase 1–3 已完成。

改动前应先读的纲领文档：`SPEC.md`（范围）、`CONTEXT.md`（领域术语——务必沿用其中的精确用词）、`docs/adr/0001`–`0006`（已锁定的决策）。剩余待办见 `TODO.md`（live backlog）。

## 常用命令

```bash
pnpm install      # 必须用 pnpm，不能用 npm/yarn（原因见下）
pnpm dev          # 启动应用 + 热重载（electron-vite dev）
pnpm typecheck    # 类型检查 main + renderer
pnpm build        # 生产构建到 ./out
pnpm start        # 预览已构建的应用（electron-vite preview）
pnpm dist:dir --arm64 # 打包 Apple Silicon 免安装应用
pnpm clean        # 删除 out / dist / coverage 等构建产物
pnpm test         # 跑 Vitest（真实 MongoDB 集成测试，见下）
```

- **类型检查 + 单测是校验闸门。** `pnpm typecheck` 会分别使用 `tsconfig.node.json` 和 `tsconfig.web.json` 覆盖全量类型——改完务必跑一次。测试分三层（详见 `test/README.md`）：**unit**（`test/unit/**`,纯逻辑,无 mongo,秒级）、**contract**（`test/contract/**`,BSON↔EJSON 跨层往返）、**integration**（`test/integration/**`,用 `mongodb-memory-server` 起真实 MongoDB,断言 EJSON-canonical 线格式）。`pnpm test:unit`（unit+contract）是 CI 闸门;`pnpm test:integration` 本地跑;`pnpm test` 全跑。**没有 linter。**
- **可测性是硬约定（写新代码时照做）：** 纯逻辑与副作用分离——渲染层纯逻辑放 `src/renderer/src/lib/`,主进程纯逻辑放 `*Core.ts`,需要活连接/特权 API 的部分只做薄封装（`shellEngine` 式,见下「Shell-on-driver」）。**新增 `lib/` 纯函数或 `*Core` 内核 → 必须配 unit 测试;新增写路径（doc 改/删）或 IPC handler → 配 integration 测试;新增 BSON 类型 → 同步改 `serialize-core.ts`+`ejson.ts` 并扩 `test/fixtures/bson-corpus.ts`。**
- **`pnpm test` 怎么跑：** 测试放在 `test/`（**不在两个 tsconfig 的 include 里**,所以 `pnpm typecheck` 不会检查它们）。`test/helpers/mongo.ts` 优先复用 `~/.cache/mongodb-binaries` 里已缓存的 `mongod` 二进制（`systemBinary`,**零下载**）；本机没有缓存二进制时 mms 会尝试联网下载。`mongodb-memory-server` 的 postinstall 已被 pnpm v10 拦截（不在 `onlyBuiltDependencies`）,所以 `pnpm install` 不会触发下载。集成测试里 `serializerPool.dispose()` 强制走内联序列化（worker 产物在测试期未构建,内联用的是同一份 core,行为一致）。
- **必须用 pnpm。** `.npmrc` 设了 `node-linker=hoisted`（Electron 不喜欢 pnpm 的软链接隔离布局）,且 `package.json#pnpm.onlyBuiltDependencies` 放行了 `electron`+`esbuild`,否则它们的二进制装不全——pnpm v10 默认拦截依赖的构建脚本。新增需要原生/下载二进制的依赖时,也要加进这里。
- **给主进程新增纯 JS 重依赖时,把它加进 `electron.vite.config.ts` 的 `main.build.externalizeDeps.exclude` 让 rollup 内联**（electron-vite 5 起 `externalizeDeps` 默认开启、旧的 `externalizeDepsPlugin` 已废弃）——electron-builder 26 的 pnpm 依赖收集器会丢叶子级传递依赖,外置的包打包后会启动即崩 "Cannot find module"（`exceljs` 丢 `util-deprecate`、`@mongosh/async-rewriter2` 丢 `ms` 都踩过）。

## 进程架构

三套源码、三套构建产物（`electron.vite.config.ts`）、三个路径别名——`@shared`、`@renderer`,`main` 内部走相对引用：

- **`src/main/`** —— Electron 主进程（Node）。掌管所有特权操作：MongoClient 连接、SSH 隧道、`vm` shell 沙箱、JSON 配置存储、Keychain 密钥、序列化 worker。
- **`src/preload/`** —— 上下文隔离的桥接层。只暴露一个带类型的 `window.api`（`contextBridge`）；渲染进程**碰不到**其它任何东西（没有 Node,没有 `ipcRenderer`）。
- **`src/renderer/`** —— React UI。所有后端访问都经由 `window.api`,绝不直接触碰 Node。
- **`src/shared/`** —— IPC 契约（`ipc.ts` = 通道名 + `Api` 接口；`types.ts` = 线传类型）,三端共同引用。**这是核心接缝：改动任何 IPC 行为,都要同步、连带地修改 `ipc.ts`、`preload/index.ts`、`main/ipc/registerIpc.ts` 和渲染进程的 store。**

任意功能的数据流：`useAppStore` 里的 action → `window.api.x.y()` → preload 的 `invoke` → `registerIpc` 的 handler → 某个 `main/` 模块 → 原路返回。新增一个 IPC 调用,要动这四个文件 + `shared/types.ts` 里的类型。

## 跨文件的关键机制（需读多个文件才能理解）

### Shell-on-driver（ADR-0003）
拆成两层：**`main/mongo/shellCore.ts`** 是纯执行核心（不依赖 `sessionManager`/electron,所以能在 `vm` 里对真实 `Db` 单测,见 `test/integration/shellCore.test.ts`）；**`main/mongo/shellEngine.ts`** 只是薄封装——从 `sessionManager` 取出活跃 client 再委托给 `runShellOnDb`。这套「纯 core + 薄 session 封装」是全项目可测性约定的范本（见上「可测性是硬约定」）。

核心在 Node `vm` 沙箱里执行用户的 JS,其中 `db` 是官方 driver `Db` 上的 `Proxy`：`db.<任意名>` 解析为真实的 `Collection`(所以 `db.lives.find()` 能用),真正的 `Db` 方法直接透传。为兼容 mongosh / NoSQLBooster 片段做了一批 shim(db 层方法、collection 层 Proxy、cursor 原型 patch、EJSON 构造器四类),**完整清单见 `shellCore.ts` 的 shim 定义**。几个会写错的语义坑:

- `find(q, projection)` / `findOne(q, projection)` 的**第二个位置参数是 projection**(mongosh 语义,而非 driver 的 options)。
- cursor 层 patch(`projection`→`project`、`pretty` no-op、`itcount`/`size` 物化计数)幂等地打到 `FindCursor`/`AggregationCursor` 原型。
- EJSON 构造器(`NumberInt`→真正的 `Int32`、`Timestamp(t, i)` 两参形式等)都包了 `callableCtor`,可带/不带 `new` 调用。

我们**有意只实现 shell API 的一个子集**——缺失的应当报错,绝不静默错（典型坑:从前 `db.runCommand(...)` 会被当成名为 "runCommand" 的集合,已修）。注意 `vm` 沙箱里抛出的错误来自**不同 realm**,`instanceof Error` 为 false——`describeError` 用 duck-typing 提取真实 `name`/`message`,否则错误名会被压平成 "Error"。

**隐式 await（mongosh 同款）**：用户代码先经 `@mongosh/async-rewriter2` 转译再进 `vm`,被打了 `Symbol.for('@@mongosh.syntheticPromise')` 标记的 promise（proxy 透传方法 + cursor 原型 patch 统一打标）会在每个表达式处被隐式 await——所以 `const ids = db.x.distinct('k')` 拿到的是数组,多语句脚本自然顺序执行,和 mongosh 行为一致。脚本的最后一个表达式仍是返回值（REPL 完成值语义）。顶层 `await` 走降级路径（`wrapTopLevelAwait` 包成 async IIFE 并保留完成值）。转译有 50 条的 FIFO 缓存（翻页/刷新重复跑同一段代码）。**改 proxy/cursor patch 时务必保住打标逻辑**,否则多步脚本会拿到 Promise 而不是值。

**print 输出捕获**：`print`/`printjson`/`console.*` 不是 no-op——沙箱内收集原始参数（上限 `MAX_OUTPUT_LINES = 1000`）,运行后经 serializerPool 转成 EJSON-canonical 的 `ShellResult.output` 下发,渲染层 Console 视图展示（纯 print 脚本自动落 Console;错误结果保留失败前的输出）。

游标按有界页拉取（`DEFAULT_LIMIT = 50`,多取一条用于判断是否被截断）;显式 `toArray()`/`itcount()` 是用户主动要求,会全量物化。绝不把整个集合塞进内存。

### 序列化下沉到 worker + 内联降级（ADR-0004 第 3、4 条）
`main/workers/serializerPool.ts` 是单个常驻 worker（`serializer.worker.ts`,作为**独立的 rollup input** 构建为 `out/main/serializer.worker.js`）的主线程客户端。主线程只做开销小的二进制 `BSON.serialize`；worker 做昂贵的 EJSON 编码 + 字段提取。**关键健壮性契约：** worker 起不来或崩溃时,池会透明地降级为内联执行**同一份** core 帮助函数（`serialize-core.ts`）——绝不能因 worker 抖动而白屏或卡死。改动池时,务必保住这套降级逻辑和那条 "no transferList" 注释（转移 BSON buffer 可能误伤 Node 的共享分配池）。退出时（`will-quit`）销毁。

### EJSON-canonical 线格式（main↔renderer 的数据契约）
后端把所有 BSON 结果序列化为 **EJSON-canonical 纯对象**（`{ "$oid": … }`、`{ "$date": … }`、`{ "$numberLong": … }` 等）。`renderer/src/lib/ejson.ts` 是**唯一**懂这套形状的地方——由它决定显示字符串、类型标签,以及（最关键的）Tree/Table/JSON 视图里哪些节点可展开。新增任何 BSON 类型支持,都要同时改序列化 core 和 `ejson.ts`。

### 渲染进程状态 —— Zustand v5,**必须返回稳定引用**
`renderer/src/store/useAppStore.ts` 是唯一真相源；所有 `window.api` 调用都在这里,每个异步 action 都 catch 错误并以 `lastError` 呈现,而非把异常抛进 UI。**会导致白屏的坑：** Zustand v5 的 selector 必须返回稳定引用。store 里持有 `Set`（`expanded`、`loading`、`expandedConnections`）和嵌套 `Record`——在 `set()` 里务必新建 Set/对象（参考已有的不可变更新写法）,也绝不要在 selector 里返回未 memo 的全新对象/数组字面量。目录树按节点**懒加载**（collections/indexes/users 仅在展开时拉取）,断开连接时销毁（ADR-0004 第 6 条）。

### 密钥与持久化（ADR-0006）
应用状态以纯 JSON 存于 Electron `userData`：`connections.json`、`queries.json`（保存的查询 + 有上限的历史）、`settings.json`——不用 SQLite（避免原生模块重编译的折腾）。存储模块在 `main/store/`。密钥（密码、SSH passphrase）**绝不**以明文落入这些文件,**绝不**跨 IPC：`connectionStore` 用 Electron `safeStorage`（macOS Keychain）加密；渲染进程只看到 `hasPassword` 之类的布尔标志。解密只在连接时、在 `main/` 内部发生。

## 样式（CSS）约定

视觉层正从「纯手写 CSS」迁移到 **Tailwind v4 + shadcn 风原语（基于 `@base-ui/react`）**,当前是**混合态**:共享表单/弹窗原语(`components/ui/*` + `common/Button`)与连接弹窗已 Tailwind 化;其余分区仍是手写 CSS(已被令牌重新上色)。设计令牌体系见 `DESIGN.md`——**Warm Stone + Ink**(暖灰纸面 + 石墨结构强调,亮暗平等;数据/代码字体 **JetBrains Mono**)。

**Tailwind 接入(CSS-first,无 `tailwind.config`):**
- `@tailwindcss/vite` 挂在 `electron.vite.config.ts` 的 `renderer.plugins`;`@` 别名指向 `src/renderer/src`(`tsconfig.web.json` + vite 对称,shadcn 约定)。
- `styles/index.css` 顶部**只引 Tailwind 的 theme + utilities 层、不引 preflight**(迁移期避免全局 reset 扰动未迁移的手写 CSS);末尾 `@theme inline` 把 shadcn 色名映射到我们的语义令牌。**命名坑:** 我们的 `--accent`=品牌 Ink → 映射成 shadcn `primary`;shadcn 的 `accent`(hover 底)→ `--bg-3`。
- **关键层叠规则:** 未分层的手写 CSS 优先级**高于** `@layer utilities`。所以裸元素默认规则(`base.css` 全文 + `theme-polish.css` 的通用 `button/input/select/textarea` 块)都收进 **`@layer base`**,迁移组件的 Tailwind 工具类才能盖过它们;原生元素仍取默认。**新组件用 Tailwind 即可生效;若被某条手写规则压住,多半是那条裸元素规则没进 base 层。**
- shadcn 风原语 = `@base-ui/react` 无样式原语 + Tailwind 工具类 + `cva` 变体(范本 `common/Button.tsx`);class 合并用 `lib/utils.ts` 的 `cn()`(clsx + tailwind-merge)。门面在 `components/ui/*`(对外 props 不变,业务**不**直接 import Base UI)。

**仍在用的手写分区(`styles/`,`index.css` 固定顺序 @import):** `tokens`(令牌底座) → `base`(@layer base) → `app-shell`/`explorer`/`work-area`/`results`/`modals-forms`/`phase2`/`phase3` → `theme-polish`(后置修饰) → `base-ui`(收尾)。**@import 顺序仍是层叠契约,别打乱**(`tokens` 最先、`theme-polish` 在功能分区之后);这些分区随迁移逐步清退到 Tailwind。

- **何时 Tailwind vs 全局 vs CSS Module:**
  - **新组件 / 重做组件 → Tailwind 工具类 + `cva`**(首选,见 `components/ui/*`)。
  - **永远全局**:`tokens.css` 令牌、第三方选择器(CodeMirror `.cm-*`、Base UI `[data-*]`)、跨组件复用的共享数据词汇(`.v-*` 类型色、`.kv-row`、`.vrow`)。
  - **CSS Module**(`Foo.module.css`,作用域隔离):自包含组件,范本 `components/shell/pipeline/pipeline.module.css`。
  - 复用既有 result/tree/table/explorer 词汇的老组件 → 暂留全局,随迁移再说;不强制回迁。

## 性能铁律（ADR-0004 —— 不可妥协,每个功能都必须遵守）

七条全文见 `SPEC.md` §3 / ADR-0004。下面是本仓库的落点锚（改代码时对照）：

1. 大列表/树/表格一律虚拟化（`@tanstack/react-virtual`）——结果三视图 + Console 已用;**目录树尚未,见 `TODO.md`**。
2. schema/字段采样:懒、有界(~50 文档)、异步、缓存 → `main/mongo/catalog.ts` 的 `sampleFields`。
3. **打开集合不自动查询**:只把 `db.coll.find({})` 填进编辑器,绝不执行;加载保存的查询/历史同理。
4. 游标在数据层分页限界、重 CPU 走序列化 worker;关闭 tab/连接即销毁,退出 `will-quit`(`main/index.ts`)清理 client / SSH 隧道 / worker。
5. 各目标架构出原生包(arm64+x64,不走 Rosetta),重功能懒加载(CodeMirror 6)。
