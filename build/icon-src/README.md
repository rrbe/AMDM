# 应用图标

**设计：`{ ⋯ }` 文档** —— 花括号 = BSON 文档 / JSON,正中 MongoDB 存储的核心(文档型数据库)。
纯色平面,无任何光照/渐变/噪点:深绿黑磁贴 + emerald 绿。

- **大尺寸(≥64px)**:完整 `{ ⋯ }`,三点表示文档内容(`icon.svg`)。
- **小尺寸(16/32/48px)**:加粗花括号 + 单点(`icon-small.svg`)——三个小点在 tray/Finder 里会糊成一团,故简化。

## 产物(位于上一级 `build/`)

| 文件 | 用途 |
| --- | --- |
| `icon.icns` | macOS(electron-builder 自动识别) |
| `icon.ico` | Windows,内嵌 16/32/48/64/128/256 多尺寸 PNG |
| `icon.png` | 1024×1024,Linux + electron-builder 基准图 |
| `icon-512.png` | 512×512 备用 |

`build/` 是 electron-builder 默认的图标查找目录,接好打包后**无需额外配置**即会被采用。

## 重新生成

改 `icon.svg` / `icon-small.svg` 后,跑:

```bash
build/icon-src/gen.sh
```

依赖:macOS 自带的 `iconutil` + `sips`,以及 Google Chrome(用作高保真 SVG 光栅化器——
`sips` 自带的 SVG 引擎会忽略渐变/滤镜,故不直接用它栅格化矢量)。`mkico.js` 用 Node 把多张 PNG 打包成 `.ico`。

## 调色

- 磁贴:`#0E1F17`(深绿黑)
- 花括号 / 点:`#37E08B`(emerald)

> 想换亮色版(如绿底白标):把两个 SVG 里的 `fill`/`stroke` 颜色互换重跑 `gen.sh` 即可。
