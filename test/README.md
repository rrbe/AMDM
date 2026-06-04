# 测试体系

本目录是项目的测试框架。目标不是「补测试」，而是**为代码质量长期兜底**：质量回归被自动拦住、新功能天然带测试、数据契约跨层不漂移。

## 三层

| 层 | 目录 | 需要 mongo | 何时跑 |
|---|---|---|---|
| **unit** 纯逻辑 | `test/unit/**` | 否（秒级） | 本地 + CI 闸门 |
| **contract** 数据契约 round-trip | `test/contract/**` | 否 | 本地 + CI 闸门 |
| **integration** 真实 mongo | `test/integration/**` | 是 | 本地（CI 暂不跑） |

unit/contract **不 import** `helpers/mongo.ts`，因此不会启动 mongod —— CI 上稳定、秒级。

## 命令

```bash
pnpm test:unit          # unit + contract（CI 用这个，无 mongo）
pnpm test:integration   # 起单个 mongod 跑集成测试（本地）
pnpm test               # 全部
pnpm test:unit --coverage   # v8 覆盖率报告
```

## 约定（写新功能时照做）

1. **纯逻辑与副作用分离**——业务逻辑写成不依赖 `sessionManager`/electron/fs 的纯函数：
   - 渲染层放 `src/renderer/src/lib/`
   - 主进程放 `*Core.ts`（如 `shellCore.ts`），需要活连接/特权 API 的部分只做薄封装（`shellEngine` 式）。
2. **新增 `lib/` 纯函数或 `*Core` 内核 → 必须配 unit 测试。**
3. **新增写路径（doc 改/删）或 IPC handler → 配 integration 测试。**
4. **新增 BSON 类型 → 同时更新 `serialize-core.ts`、`ejson.ts`，并扩 `fixtures/bson-corpus.ts`**——契约测试会自动校验跨层一致。

## 关键文件

- `helpers/mongo.ts` —— 集成测试的 MongoDB harness（优先复用 `~/.cache/mongodb-binaries` 缓存的 mongod，零下载）。
- `helpers/electron-mock.ts` —— `vi.mock('electron')` 的共用桩（`app.getPath`→tmp、`safeStorage`→base64 假加密），供 store 单测使用。
- `fixtures/bson-corpus.ts` —— 覆盖各 BSON 类型的代表性文档，**单一真相源**，被 unit / contract 多处复用。
- `contract/ejson-roundtrip.test.ts` —— 串起 `serialize-core → ejson → resultCopy` 三层验证同一份语料，任一层改坏立刻红。
