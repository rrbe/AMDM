# AMDM Web

AMDM Web 是供可信团队在内网使用的单实例版本。它复用桌面端的 React UI、MongoDB 执行内核和 EJSON 数据契约，通过反向代理提供的 SSO 身份隔离每位用户的连接、凭据、查询和设置。

## 首版能力

保留连接管理、目录浏览、Shell、结果视图、Explain、保存查询、历史、设置和单文档改删。SSH、Schema 建模、导入导出、更新检查及原生文件对话框仅在桌面端提供。

## 构建和运行

开发时直接运行，React 使用 Vite HMR；本地后端仅监听回环地址，并由 Vite 代理注入固定的 `local-dev` 身份：

```bash
pnpm dev:web
```

访问 `http://127.0.0.1:5173`。本地凭据密钥和状态自动保存在已忽略的 `.web-data/`。

生产环境构建和运行：

```bash
pnpm build:web

export AMDM_WEB_ORIGIN='https://amdm.internal.example'
export AMDM_WEB_MASTER_KEY="$(openssl rand -base64 32)"
export AMDM_WEB_DATA_DIR='/var/lib/amdm-web'
pnpm start:web
```

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

`/healthz` 不包含用户数据，可供本机健康检查使用。所有 RPC 都要求可信 Origin、JSON Content-Type 和 `X-Forwarded-User`。

## 安全边界

- 每个连接和运行中的 Session 都绑定 SSO 用户；其他用户即使知道 ID 也不能访问或取消。
- MongoDB 密码使用 AES-256-GCM 加密，用户状态文件原子写入且权限为 `0600`。
- 文档改删和 Shell 执行写入 `audit.ndjson`，不记录密码、查询代码、完整文档或返回结果。
- 当前 Shell 使用 Node `vm`，它不是不可信代码沙箱。只有完全可信的团队成员才能获得 AMDM Web 访问权；否则必须关闭 Shell 或增加 OS/容器级隔离。
- 状态存储是单实例 JSON 持久卷，不支持多个 Node 实例同时写入。
