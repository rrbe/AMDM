# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

一个精简、性能优先的 MongoDB 桌面 GUI，Electron 驱动

> 尚在开发中，请勿用在重要场合，不对数据丢失负责

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
