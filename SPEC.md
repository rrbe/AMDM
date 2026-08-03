# AMDM — SPEC

一个精简、性能优先的 MongoDB 桌面 GUI。

## 范围边界

- 支持 SCRAM、SSH 隧道、TLS、自签 CA、客户端证书、副本集和 `mongodb+srv`;不做 x.509、LDAP、AWS IAM、Kerberos。
- 密码和 SSH 口令只存 Keychain;其他配置存本地 JSON。
- Shell 在 Node `vm` 中执行常用 mongosh API 子集并返回 typed BSON;未支持的 helper 必须明确报错。
- 首次打开集合自动执行 `find({}).sort({ _id: -1 }).limit(100)`;再次打开只聚焦已有 Shell。
- 保存查询分连接级和全局级;历史独立保存,加载后不自动执行。
- 原生支持 JSON/EJSON、CSV、XLSX、BSON 导入导出,不依赖外部 MongoDB 工具。
- 结果提供 Tree、JSON、Table 视图;打印输出单独显示在 Console。
- 支持文档编辑、删除和表格内联单元格编辑。

## 性能约束

1. 大列表、树、表格必须虚拟化。
2. 游标在数据层分页限界;显式 `toArray()` 等用户操作除外。
3. BSON/EJSON 序列化和字段采样等重 CPU 工作放入 worker,失败时可内联降级。
4. schema 采样必须懒加载、有界、异步并缓存。
5. 关闭 tab/连接和应用退出时清理结果缓存、MongoClient、SSH 隧道及 worker。
6. macOS arm64/x64 均构建原生产物;CodeMirror 等重功能懒加载。
