# TODO

## 侧边栏目录树虚拟化　`[难度: 高] [风险: 中]`

`Explorer.tsx` 仍用 `rows.map()` 直渲。仅在单连接集合数极多时明显卡顿;实现时需用 `@tanstack/react-virtual` 的 sticky-index 方案保留连接段头。

## 导入侧增量解析　`[难度: 中] [风险: 低]`

JSON/BSON 导入仍会一次性读入整个文件;大文件需要边解析边按批插入。CSV/XLSX 路径也应保持有界内存。

## SSH 隧道增强

- **运行期掉线上报**　`[难度: 中] [风险: 中–高]`：增加 main → renderer 状态推送,避免隧道掉线后仍显示 connected。
- **多跳跳板链**　`[难度: 中] [风险: 低]`：当前只支持单跳 `SshConfig.jump`。
- **跳板机密码认证**　`[难度: 中] [风险: 中]`：当前跳板机仅支持带口令的私钥。
- **粘贴私钥内容**　`[难度: 低–中] [风险: 低]`：当前只支持选择私钥文件。
- **连接总超时**　`[难度: 低] [风险: 低]`：连接可取消,但 SSH 20s + MongoDB 30s 仍缺统一 deadline。
- **隧道 / 驱动自动重连**　`[难度: 中] [风险: 中]`：依赖运行期掉线事件。

2026-09-02 可以做的一些方向

我看下来，AMDM 已经不是“MongoDB 数据查看器”了，而是一个偏开发者、性能优先的 MongoDB 工作台：

- 已有 mongosh 风格 Shell、自动补全、历史与保存查询
- Tree / Table / JSON / Console、内联编辑和分页
- Schema 抽样分析与本地模型编辑
- 可视化 Explain
- 完整 BSON / EJSON / JSONL / CSV / TSV / XLSX 导入导出
- SSH、TLS、安全存储、任务取消、超时和跨平台更新

当前最大的缺口不是再增加一种结果视图，而是把“能通过 Shell 完成的事情”升级为“MongoDB 专属、可解释、低风险的图形化工作流”。

## 我最推荐的功能

| 优先级 | 功能 | 价值 | 成本 |
|---|---|---|---|
| P0 | Schema 校验发布闭环 | 很高 | 中 |
| P0 | 索引工作台 | 很高 | 中 |
| P0 | 聚合管道工作台 | 很高 | 中高 |
| P1 | Change Stream 实时观察器 | 高 | 中 |
| P1 | 实时性能与运行中操作 | 高 | 中高 |
| P1 | 数据库对象管理 | 中高 | 中 |
| P2 | 环境间数据与 Schema 对比 | 高 | 中高 |
| P2 | Search / Vector Search 管理 | 中高 | 高 |
| P3 | Queryable Encryption | 高但受众窄 | 很高 |

### 1. Schema 校验发布闭环

这是我认为最应该先做的。

项目已经能抽样分析 Schema、生成 JSON Schema、人工编辑并保存草稿，但目前草稿只存在本地，没有真正作用到 MongoDB。可以补成：

- 读取集合当前 `validator`、`validationLevel`、`validationAction`
- 将“观察到的 Schema / 本地草稿 / 服务端规则”三方对比
- 发布前统计现有文档中不符合规则的数量，并提供有限样本
- 生成并预览 `collMod`
- 支持 `warn → error` 的渐进式启用
- 保留发布前后的规则快照，支持生成回滚命令

这条路径和现有 [Schema 模型](/Users/gaoxin/code/AMDM/src/renderer/src/components/schema/SchemaModelModal.tsx) 几乎是天然衔接。MongoDB 的 Schema Validation 本身支持验证级别、拒绝或告警，也能查询不符合规则的文档。[MongoDB Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/)、[查询无效文档](https://www.mongodb.com/docs/manual/core/schema-validation/use-json-schema-query-conditions/)

### 2. 索引工作台

目前索引主要是“列出和查看定义”，下一步应该把它做成 AMDM 的核心竞争力：

- 图形化创建普通、复合、唯一、稀疏、TTL、Partial、Wildcard、Geo、Hashed 索引
- 显示索引大小、使用次数、是否隐藏、构建状态
- 将最近一次 Explain 与已有索引关联
- 标出 `COLLSCAN`、高 `docsExamined / nReturned`、排序落盘等问题
- 从当前查询生成候选索引，但必须让用户确认字段顺序
- 支持先隐藏索引观察，而不是直接删除
- 创建或删除前展示等价 mongosh 命令

MongoDB 索引种类和选项很多，仅让用户手写 `createIndex()` 很浪费桌面 GUI 的优势。[MongoDB 索引类型](https://www.mongodb.com/docs/manual/core/indexes/index-types/)

这里不建议第一版直接做“自动优化”。先做可解释的证据面板，让用户知道建议来自哪个查询、哪个 Explain 指标。

### 3. 聚合管道工作台

Shell 已经支持 `aggregate()`，但复杂管道仍然很难调试。建议增加：

- 每个 Stage 独立卡片，可启用、禁用和排序
- 每一级只预览有限条数据
- 同时显示该 Stage 的输入、输出数量和耗时
- Text 与 Stage 两种模式无损切换
- `$match`、`$project`、`$group`、`$lookup`、`$unwind` 等常用模板
- 能保存为现有 Saved Query
- 可直接 Explain
- `$out`、`$merge` 等写入 Stage 明确标记并二次确认

Compass 的同类工作流已经证明逐级预览很适合排查复杂聚合；AMDM 可以把它做得更轻、更偏键盘操作。[MongoDB 聚合管道工作台说明](https://www.mongodb.com/docs/compass/create-agg-pipeline/)

### 4. Change Stream 实时观察器

这是非常 MongoDB 专属、也很容易形成辨识度的功能：

- 对集合、数据库或部署监听变更
- 按 operationType、namespace、documentKey 过滤
- 暂停 UI 显示但保持消费，或彻底停止订阅
- 显示 insert / update / replace / delete 的字段差异
- 保存 Resume Token，并明确显示是否还能恢复
- 将某个事件转换为查询条件
- 有界事件缓冲、虚拟化列表、丢弃计数和一键清空

MongoDB Change Stream 可以监听集合、数据库或整个部署，并支持 Resume Token；实现时必须由标签页持有并释放 cursor，正好符合项目现有资源所有权约束。[MongoDB Change Streams](https://www.mongodb.com/docs/manual/changeStreams/)

### 5. 实时性能与运行中操作

建议做成只读优先的“诊断中心”：

- 连接数、读写吞吐、网络、内存、锁与队列
- 当前长耗时操作列表
- operation、namespace、耗时、客户端、等待状态
- 从慢操作打开查询或生成 Explain
- 有权限时提供 Kill Operation，并要求输入确认
- Replica Set 成员、Primary、复制延迟
- Sharded Cluster 的 shard、chunk 分布和 balancer 状态

新版本应优先使用 `$currentOp`，旧 `currentOp` 命令从 MongoDB 6.2 起已经弃用。[`$currentOp` 官方文档](https://www.mongodb.com/docs/manual/reference/operator/aggregation/currentOp/)

Profiler 不应自动开启：官方明确提醒它可能影响性能，优先读取 `$queryStats`、现有 profiler 数据或实时操作；只有用户明确操作时才改变 profiling level。[MongoDB Database Profiler](https://www.mongodb.com/docs/manual/tutorial/manage-the-database-profiler/)

### 6. 数据库对象管理

这是产品完整度方面最明显的缺口：

- 创建、重命名、删除数据库或集合
- 创建 View、Time Series、Capped Collection
- 修改集合 validator、collation、TTL 等配置
- 图形化管理用户和角色
- 索引创建、隐藏和删除
- 危险操作展示目标连接、数据库、集合，并要求输入名称确认

这些现在大多可以在 Shell 中做，但浏览器右键菜单基本只有刷新、Schema、导入导出。可以先覆盖高频 DDL，无需试图把所有 `runCommand` 都表单化。

### 7. 环境间对比与迁移

这是比普通 CRUD 更适合桌面工具的能力：

- 对比开发、测试、生产的集合、索引和 validator
- 检测 Schema 类型分布漂移
- 生成只读差异报告
- 选择性生成索引或 validator 迁移脚本
- 对两个查询结果按 `_id` 或指定键做差异比较
- 导出可审查的 mongosh 脚本，而不是直接批量修改目标库

它能让 AMDM 从“单连接管理器”迈向日常工程工具，而且可以复用现有多连接、Schema、EJSON 和导出基础。

## 后续差异化方向

- Search / Vector Search：管理 Search Index、Vector Index，提供 `$search` / `$vectorSearch` 模板及结果评分展示。MongoDB 现在已经把相关能力扩展到 Atlas、本地 Atlas 部署以及部分自托管场景，但部署兼容性复杂，建议后置。[Vector Search Index](https://www.mongodb.com/docs/compass/indexes/create-vector-search-index/)、[本地 Search / Vector Search](https://www.mongodb.com/docs/search/self-managed/current/installation/quick-start/)
- Queryable Encryption：配置 KMS、Key Vault、Encrypted Fields，并确保密钥和明文只在 main 使用。这很有专业性，但涉及原生依赖、KMS、兼容矩阵和极高的数据安全责任，暂时不适合作为近期主线。[Queryable Encryption](https://www.mongodb.com/docs/manual/core/queryable-encryption/)
- 备份恢复：可以集成 `mongodump` / `mongorestore`，但需要处理工具版本、凭据传递、进程管理和大文件进度。我会把它放在上述功能之后。
- 地理空间查看器：GeoJSON 地图预览、框选生成 `$geoWithin`、索引检查，价值明确但受众相对窄。

## 我建议的实际顺序

在扩展产品功能前，先完成 [TODO.md](/Users/gaoxin/code/AMDM/TODO.md) 中的增量导入、Explorer 虚拟化和 SSH 掉线状态上报；它们是后续处理大集合和长生命周期任务的基础。

随后按这个顺序推进：

1. Schema 校验发布闭环
2. 索引工作台
3. 聚合管道工作台
4. Change Stream 观察器
5. 性能诊断中心
6. 数据库对象管理
7. 环境对比与迁移
8. Search / Vector Search

如果只能选一个，我选“Schema 校验发布闭环”；如果选一个能显著提高产品辨识度的组合，我选“索引工作台 + Change Stream 观察器”。我暂时不会优先加入聊天式 AI——AMDM 当前更值得建立的优势，是本地、快速、可解释、不会偷偷查询或上传数据的 MongoDB 专业工具。
