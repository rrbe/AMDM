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

- `SPARKLE_ED_PRIVATE_KEY`：由 Sparkle `generate_keys -x` 导出的私钥，只配置为 GitHub Actions Secret。AMDM 与 LocalShare 使用相同公钥，可以复用已有私钥。

发布工作流会生成并上传 `appcast-arm64.xml` 与 `appcast-x64.xml`。

macOS 产物使用 ad-hoc 签名且未经 Apple 公证。首次打开时可能需要在“隐私与安全性”中点击“仍要打开”，或执行 `xattr -dr com.apple.quarantine /Applications/AMDM.app` 清除隔离标记。

## 许可证

[MIT](./LICENSE)

> AMDM 是非官方 MongoDB 客户端，和 MongoDB, Inc. 没有任何关系。
