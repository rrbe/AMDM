# AMDM Web

AMDM Web runs as a single instance on a trusted team's internal network. It shares the desktop app's React interface, MongoDB execution engine, and EJSON data contract. The reverse proxy supplies an SSO identity that keeps each user's connections, credentials, queries, and settings separate.

## Features

The web interface supports connection duplication, permission inspection, catalog search, Quick Search, and draggable Query and Data tabs. Users can run Mongosh and Node Driver queries, page through results, inspect nested tables, fold JSON, and view Explain plans. The workspace also includes saved queries, query history, schema analysis and drafts, and a resizable details sidebar. Users can refresh, edit, or delete individual documents and drop collections. Settings cover themes, language, color schemes, and keyboard shortcuts.

SSH, file import and export, update checks, and native file dialogs are available only in the desktop app. In the web edition, TLS file paths refer to files on the server and must be configured by a trusted administrator.

## Data storage

Choose a mode in **Settings → Storage**.

- **Server storage (default)** saves connections, saved queries, history, settings, schema analyses, and drafts on the server under the user's SSO identity. The server encrypts MongoDB passwords with AES-256-GCM. Users can access their saved data from another browser by signing in with the same account.
- **Browser storage** keeps the same data in IndexedDB, scoped to the site and SSO user. Users enter their password each time they connect. Neither the browser nor the server writes it to disk. The server holds it in memory until the connection fails, disconnects, or the page closes. Clearing site data removes these local records. They do not sync across browsers.

Each mode keeps its own dataset. Switching modes reloads the page, closes its connections and results, and discards unsaved changes. Existing records stay in their original store. The browser remembers the choice and reloads other tabs signed in to the same account.

In both modes, the server connects to MongoDB, executes queries, and audits operations. Audit records exclude passwords, query code, and document contents.

## Build and run

Start the development server with React hot module replacement:

```bash
pnpm dev:web
```

Open `http://127.0.0.1:5173` locally or `http://<Tailscale IP>:5173` over Tailscale. Vite listens on all network interfaces. The development middleware assigns the same `local-dev` identity to every request, so expose the server only on a trusted network. The credential encryption key and local state are stored in the Git-ignored `.web-data/` directory.

For the first production deployment, generate a master key with `openssl rand -base64 32`. Save it in a secret manager and back it up. Configure the deployment environment to supply that same key as `AMDM_WEB_MASTER_KEY` on every start and upgrade. Losing or replacing the key makes previously saved MongoDB passwords unreadable.

With the key configured, build and start the service:

```bash
pnpm build:web

export AMDM_WEB_ORIGIN='https://amdm.internal.example'
export AMDM_WEB_DATA_DIR='/var/lib/amdm-web'
pnpm start:web
```

Deploy `out/web/` and `out/web-server/` with Node.js 24.11 or later and the production dependencies installed. The server output includes the standalone Mongosh runtime and the serialization worker.

The browser client, browser workers, Node.js server, and Mongosh runtime use ES modules. Settings, the history and saved-query views, and the full Shell editor load on demand. The editor loads when the workspace opens. Its completion worker starts when the editor first receives focus.

The client build generates `.br` and `.gz` variants for JavaScript, CSS, HTML, JSON, and SVG files of at least 1 KB when compression reduces their size. This includes browser workers. Deploy the compressed files alongside the originals. The static server uses `Accept-Encoding` to select a precompressed response and sends `Vary: Accept-Encoding`. HTML uses `no-cache`, and hashed assets use `immutable` caching for one year.

By default, the service listens on `127.0.0.1:4173`. Use `AMDM_WEB_HOST` and `AMDM_WEB_PORT` to change the listening address and `AMDM_WEB_STATIC_DIR` to change the static asset directory. Keep the service behind the reverse proxy.

## Reverse proxy requirements

1. Serve all routes over HTTPS and require SSO authentication on every route.
2. Strip any client-supplied `X-Forwarded-User` header and set it to the authenticated user's unique identifier.
3. Forward the browser's original `Origin` header. It must match `AMDM_WEB_ORIGIN`.

Adapt the authentication step in this minimal Nginx example to your OIDC or SSO gateway:

```nginx
location / {
    # auth_request /oauth2/auth;  # Use your gateway's authentication configuration.
    proxy_set_header X-Forwarded-User $remote_user;
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:4173;
}
```

Use `/healthz` for local health checks. It contains no user data. All RPC requests require a trusted origin, a JSON content type, and `X-Forwarded-User`. The `/api/events` endpoint streams connection status using server-sent events. Disable proxy response buffering for this route and allow long-lived connections.

## Security boundaries

- Each connection and active session belongs to an SSO user. Paged results and cancellation requests also belong to a specific browser page. Knowing a result ID does not give another user or page access. Closing a page's status stream releases its cursors, caches, and document refresh tasks. In server storage mode, database connections close when the user's last page closes. In browser storage mode, each page owns its connections and releases them when it closes.
- In server storage mode, the server encrypts MongoDB passwords with AES-256-GCM and writes user state files atomically with `0600` permissions. In browser storage mode, passwords are never persisted, and connection settings, queries, history, and schema data stay out of server state files.
- The server logs collection drops, document updates and deletions, and Shell execution to `audit.ndjson`. Entries exclude passwords, query code, full documents, and results.
- The Shell runs the official Mongosh evaluator using Node.js `vm`. It does not isolate untrusted code. Grant access only to fully trusted team members. To allow access by other users, disable the Shell or isolate execution at the OS or container level.
- Store the JSON state files on a persistent volume with a single Node.js instance as the writer. Concurrent writes from multiple instances are unsupported.
