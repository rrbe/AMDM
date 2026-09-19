# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

一个精简、性能优先的 MongoDB 桌面 GUI，Electron 驱动

> 尚在开发中，请勿用在重要场合，不对数据丢失负责

![AMDM 浅色主题：聚合查询与表格结果](./docs/screenshots/table-light.png)

<details>
<summary>更多截图：文档树、深色主题与可视化 Explain</summary>

**文档树**

![嵌套订单文档、BSON 类型与集合详情](./docs/screenshots/tree-light.png)

**深色主题**

![深色 JSON 视图中的商品文档](./docs/screenshots/json-dark.png)

**可视化 Explain**

![查询执行统计与索引执行计划](./docs/screenshots/explain-light.png)

</details>

## 运行

```bash
pnpm install                         # 安装依赖
pnpm dev                             # 启动应用并热重载
pnpm typecheck                       # 检查主进程与渲染进程类型
pnpm test:unit                       # 运行单元与契约测试
pnpm build                           # 生产构建到 ./out
pnpm dist:dir --mac --arm64          # 打包未安装的 Apple Silicon 应用
pnpm install:mac                     # 打包、替换 /Applications/AMDM.app 并启动
pnpm clean                           # 清理构建产物
```

## 功能

- 浏览数据库 / 集合 / 索引 / 用户
- 数据内联编辑，多标签页查看
- `vm` 沙箱 Shell，运行 mongosh 风格的 JS（`find` / `aggregate` / `runCommand` …）
- 支持自动补全，保存常用查询、查看历史
- 原生导入 / 导出 JSON / CSV / XLSX / BSON
- Tree / JSON / Table 结果视图
- 可视化 explain

## macOS 安装

需要 macOS 12 Monterey 或更高版本。

macOS 版本通过 Sparkle 更新,使用 ad-hoc 签名且未经 Apple 公证。首次打开时请在“隐私与安全性”中点击“仍要打开”,或执行 `xattr -dr com.apple.quarantine /Applications/AMDM.app`。

## 许可证

[GNU GPL v3.0](./LICENSE)

> AMDM 是非官方 MongoDB 客户端,与 MongoDB, Inc. 无关。
