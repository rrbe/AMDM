import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import webConfig from "./vite.web.config.mts";
import { createWebRequestHandler } from "./src/web/server";
import { WebStore } from "./src/web/webStore";

const DEV_ORIGIN = "http://amdm.local";

function webBackend(): Plugin {
  return {
    name: "amdm-web-backend",
    configureServer(viteServer) {
      const dataDir = resolve(".web-data");
      const keyPath = resolve(dataDir, "master-key");
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      if (!existsSync(keyPath))
        writeFileSync(keyPath, randomBytes(32).toString("base64"), { mode: 0o600 });

      const app = createWebRequestHandler({
        store: new WebStore(dataDir, Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64")),
        origin: DEV_ORIGIN,
        staticDir: resolve("out/web"),
      });
      viteServer.middlewares.use((req, res, next) => {
        if (req.url !== "/healthz" && req.url !== "/api/rpc") return next();
        if (req.url === "/api/rpc") {
          if (req.headers.origin === `http://${req.headers.host}`) req.headers.origin = DEV_ORIGIN;
          req.headers["x-forwarded-user"] = "local-dev";
        }
        void app.handle(req, res);
      });
      viteServer.httpServer?.once("close", () => void app.closeSessions());
    },
  };
}

export default defineConfig(
  mergeConfig(webConfig, {
    plugins: [webBackend()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: ["shawns-mbp.tailnet.fairydog.net"],
    },
  }),
);
