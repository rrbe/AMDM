# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

一个精简、性能优先的 MongoDB 桌面 GUI，Electron 驱动

> 尚在开发中，请勿用在重要场合，不对数据丢失负责

## 运行

```bash
pnpm install         # 使用 pnpm
pnpm dev             # 启动应用并热重载
pnpm build           # 生产构建到 ./out
```

## 功能

- 浏览数据库 / 集合 / 索引 / 用户
- 数据内联编辑，多标签页查看
- `vm` 沙箱 Shell，运行 mongosh 风格的 JS（`find` / `aggregate` / `runCommand` …）
- 支持自动补全，保存常用查询、查看历史
- 数据导入 / 导出（JSON / CSV / XLSX 原生，支持 mongodump / mongorestore 等官方工具）
- Tree / JSON / Table 结果视图
- 可视化 explain

## 许可证

[MIT](./LICENSE)

> AMDM 是非官方 MongoDB 客户端，和 MongoDB, Inc. 没有任何关系。
