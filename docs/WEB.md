# AMDM Web

AMDM Web 是供可信团队在内网使用的单实例版本。它复用桌面端的 React UI、MongoDB 执行内核和 EJSON 数据契约，通过反向代理提供的 SSO 身份隔离每位用户的连接、凭据、查询和设置。

## 首版能力

复用当前桌面端界面：连接复制和权限展示、目录搜索、统一快速搜索、可拖动查询/数据标签、mongosh 和 Driver 查询、分页结果、嵌套表格与 JSON 折叠、Explain、保存查询、历史、Schema 分析和草稿、可调宽详情侧栏、单文档刷新/改删及集合删除。设置包括主题、语言、颜色方案和快捷键。

SSH、文件导入导出、更新检查及原生文件对话框仍在桌面端提供。Web 不显示对应入口。TLS 文件路径指向服务端文件，须由可信运维人员配置。

## 数据存储方式

在「设置 → 存储」中选择：

- **服务端存储（默认）**：连接、保存的查询、历史、设置和 Schema 分析/草稿保存在服务端，按 SSO 用户隔离。MongoDB 密码使用 AES-256-GCM 加密；同一账户可在其他浏览器访问已保存的数据。
- **浏览器存储**：以上数据保存在当前浏览器的 IndexedDB，按网站和 SSO 用户隔离。密码不写入浏览器或服务端文件，每次连接都重新输入；服务端仅在当前连接期间持有密码，断开、关闭页面或连接失败时释放。清理网站数据会删除这些本地记录；其他浏览器不会自动同步。

两种模式各自保留数据，切换时不会迁移或合并。切换会刷新页面、关闭当前页面的连接和结果，未保存的内容会丢失。选择保存在当前浏览器，同一账户的其他标签页会一起刷新到新模式。

浏览器模式仍需要服务端执行 MongoDB 连接和查询，并保留不含密码、查询代码和文档内容的操作审计。它改变的是持久化位置，不是把 MongoDB 驱动搬进浏览器。

## 构建和运行

开发时直接运行，React 使用 Vite HMR；Vite 监听所有网络接口，并由开发中间件注入固定的 `local-dev` 身份：

```bash
pnpm dev:web
```

本机访问 `http://127.0.0.1:5173`，也可以通过 `http://<Tailscale IP>:5173` 访问。本地凭据密钥和状态自动保存在已忽略的 `.web-data/`。所有开发访问共享同一个 `local-dev` 身份，因此只应暴露在可信网络中。

生产环境构建和运行：

```bash
pnpm build:web

export AMDM_WEB_ORIGIN='https://amdm.internal.example'
export AMDM_WEB_MASTER_KEY="$(openssl rand -base64 32)"
export AMDM_WEB_DATA_DIR='/var/lib/amdm-web'
pnpm start:web
```

构建产物为 `out/web/` 和 `out/web-server/`，后者包含独立 mongosh runtime 和序列化 worker。运行环境使用 Node 24.11 或更新版本，并安装生产依赖。

服务默认只监听 `127.0.0.1:4173`。可用 `AMDM_WEB_HOST`、`AMDM_WEB_PORT` 和 `AMDM_WEB_STATIC_DIR` 覆盖，但不要把服务直接暴露到网络。

`AMDM_WEB_MASTER_KEY` 必须是 32 字节随机值的 Base64 编码。丢失或更换它会使已保存的 MongoDB 密码无法解密；请放在 Secret Manager 中备份，不要提交到仓库。

## 反向代理要求

反向代理必须：

1. 使用 HTTPS，并在所有路径上完成 SSO 认证。
2. 删除客户端传入的 `X-Forwarded-User`，再用已验证的唯一用户标识覆盖它。
3. 将浏览器原始 `Origin` 传给后端；它必须与 `AMDM_WEB_ORIGIN` 一致。

最小 Nginx 形态如下，认证部分按现有 OIDC/SSO 网关替换：

```nginx
location / {
    # auth_request /oauth2/auth;  # 示例：由现有 SSO 配置负责
    proxy_set_header X-Forwarded-User $remote_user;
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:4173;
}
```

`/healthz` 不包含用户数据，可供本机健康检查使用。所有 RPC 都要求可信 Origin、JSON Content-Type 和 `X-Forwarded-User`。`/api/events` 使用 SSE 推送连接状态；反向代理须关闭该路径的响应缓冲，并允许持续连接。

## 安全边界

- 每个连接和运行中的 Session 都绑定 SSO 用户；分页结果和取消任务还绑定浏览器页面 ID。其他用户或页面即使知道结果 ID 也不能访问或取消。页面状态流关闭会释放它持有的游标、缓存和文档刷新任务；服务端模式下同一用户最后一个页面关闭时断开数据库连接；浏览器模式下每个页面独立持有连接，页面关闭即断开。
- 服务端模式的 MongoDB 密码使用 AES-256-GCM 加密，用户状态文件原子写入且权限为 `0600`。浏览器模式不持久化密码，也不把连接配置、查询、历史和 Schema 写入服务端状态文件。
- 集合删除、文档改删和 Shell 执行写入 `audit.ndjson`，不记录密码、查询代码、完整文档或返回结果。
- 当前 Shell 使用官方 mongosh evaluator 和 Node `vm`，它不是不可信代码沙箱。只有完全可信的团队成员才能获得 AMDM Web 访问权；否则必须关闭 Shell 或增加 OS/容器级隔离。
- 状态存储是单实例 JSON 持久卷，不支持多个 Node 实例同时写入。
