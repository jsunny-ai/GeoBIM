import fs from "node:fs"
import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import cesium from "vite-plugin-cesium"

// Cesium 정적 에셋 디렉토리 (CesiumUnminified = 소스맵 포함, dev용)
const cesiumBuildDir = path.resolve(
  __dirname,
  "node_modules/cesium/Build/CesiumUnminified",
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // CESIUM_BASE_URL 전역 define + 빌드 시 에셋 복사
    cesium(),
    // dev 서버에서 /cesium/* 요청을 CesiumUnminified 에서 직접 서빙
    // (vite-plugin-cesium 미들웨어가 경로 문제로 동작 안 할 때 대비)
    {
      name: "vite-cesium-static-fallback",
      configureServer(server) {
        server.middlewares.use(
          "/cesium",
          (req: any, res: any, next: () => void) => {
            const filePath = path.join(cesiumBuildDir, req.url ?? "/")
            try {
              const stat = fs.statSync(filePath)
              if (stat.isFile()) {
                const ext = path.extname(filePath).toLowerCase()
                const ct =
                  ext === ".json"
                    ? "application/json"
                    : ext === ".png"
                      ? "image/png"
                      : ext === ".jpg" || ext === ".jpeg"
                        ? "image/jpeg"
                        : ext === ".css"
                          ? "text/css"
                          : ext === ".js"
                            ? "application/javascript"
                            : ext === ".wasm"
                              ? "application/wasm"
                              : "application/octet-stream"
                res.setHeader("Content-Type", ct)
                res.setHeader("Cache-Control", "max-age=86400")
                fs.createReadStream(filePath).pipe(res)
                return
              }
            } catch {
              // 파일 없으면 next()
            }
            next()
          },
        )
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // 백엔드 FastAPI(8000) 로 /api 프록시
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  // PDF.js worker(?url 임포트)와 Cesium worker 처리를 위해 optimizeDeps 에서 제외
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
})
