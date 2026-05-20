import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"
import fs from "node:fs"
import react from "@vitejs/plugin-react"

import { defineConfig } from "vite"

const _require = createRequire(import.meta.url)

// ── Patch: prevent # in path from breaking esbuild/Vite ──────────────────────
const SAFE_PREFIX = "G:"
function fixPath(p) {
  if (typeof p !== "string") return p
  return p.replace(/C:\\antigravity\\#1_4_GeoBIM/gi, SAFE_PREFIX)
         .replace(/C:\/antigravity\/#1_4_GeoBIM/gi, SAFE_PREFIX)
}
const _orig = fs.realpathSync.bind(fs)
const _origNative = fs.realpathSync.native.bind(fs)
const _origPromise = fs.promises.realpath.bind(fs.promises)
fs.realpathSync = function patchedRealpathSync(p, opts) { return fixPath(_orig(p, opts)) }
fs.realpathSync.native = function patchedRealpathSyncNative(p, opts) { return fixPath(_origNative(p, opts)) }
fs.promises.realpath = async function patchedRealpathPromise(p, opts) { return fixPath(await _origPromise(p, opts)) }
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))

const tailwindConfig = _require("./tailwind.config.cjs")
const tailwindcss = _require("tailwindcss")
const autoprefixer = _require("autoprefixer")

// Fix @vite/client: same # path truncation issue as projects
const _vitePkg = fixPath(_require.resolve("vite/package.json")).replace(/\\/g, "/")
const _viteDir = _vitePkg.replace(/\/package\.json$/, "")
const _viteClientMjs = `${_viteDir}/dist/client/client.mjs`
const _viteEnvMjs   = `${_viteDir}/dist/client/env.mjs`

const fixViteClientPlugin = {
  name: "fix-vite-client-path",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url) {
        if (/^\/@vite\/client(\?|$)/.test(req.url))
          req.url = req.url.replace(/^\/@vite\/client/, `/@fs/${_viteClientMjs}`)
        else if (/^\/@vite\/env(\?|$)/.test(req.url))
          req.url = req.url.replace(/^\/@vite\/env/, `/@fs/${_viteEnvMjs}`)
      }
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), fixViteClientPlugin],
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
  cacheDir: resolve(__dirname, "../../.vite-cache/viewer-3d"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "../../shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
})
