# AMDM (Another Mongo Desktop Manager)

[English](./README.md) | [中文](./README_CN.md)

一个精简、性能优先的 MongoDB 桌面 GUI，Electron 驱动

> 尚在开发中，请勿用在重要场合，不对数据丢失负责

## 运行

```bash
pnpm install         # 使用 pnpm
pnpm dev             # 启动应用并热重载
pnpm build           # 生产构建到 ./out
pnpm dist:dir --arm64 # 打包 Apple Silicon 免安装应用
pnpm clean           # 清理构建产物
```

## 功能

- 浏览数据库 / 集合 / 索引 / 用户
- 数据内联编辑，多标签页查看
- `vm` 沙箱 Shell，运行 mongosh 风格的 JS（`find` / `aggregate` / `runCommand` …）
- 支持自动补全，保存常用查询、查看历史
- 原生导入 / 导出 JSON / CSV / XLSX / BSON
- Tree / JSON / Table 结果视图
- 可视化 explain

## macOS 自动更新

macOS 安装包内置 Sparkle 2，会按天检查并在后台下载新版本。发布前需要配置：

- `SPARKLE_PUBLIC_ED_KEY`：Sparkle 公钥，作为 GitHub Actions Secret，同时传给打包步骤。
- `SPARKLE_PRIVATE_ED_KEY`：由 Sparkle `generate_keys -x` 导出的私钥，只配置为 GitHub Actions Secret。
- `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`：Developer ID Application 证书及其密码，供 GitHub Actions 签名 macOS 包。

发布工作流会生成并上传 `appcast.xml`。本地打包 macOS 产物时也需要提供 `SPARKLE_PUBLIC_ED_KEY`。

正式分发还需要 Apple Developer ID 签名（electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD`）和公证凭据；本地 ad-hoc 包只用于验证打包结构，不代表更新链路可用。

## 许可证

[MIT](./LICENSE)

> AMDM 是非官方 MongoDB 客户端，和 MongoDB, Inc. 没有任何关系。
