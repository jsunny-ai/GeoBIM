import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import MapPage from "@/pages/MapPage"
import Step2Page from "@/pages/Step2Page"
import Step3Page from "@/pages/Step3Page"

/**
 * 3단계 분석 워크플로우:
 *   /          → Step1: 2D 지도 + bbox 영역 선택
 *   /step2     → Step2: 지형 솔리드 (AWS Terrain + IDW + Three.js) — 구현 예정
 *   /step3     → Step3: 3D 지층 솔리드 (복셀 + 마칭큐브)
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<MapPage />} />
        <Route path="/step2" element={<Step2Page />} />
        <Route path="/step3" element={<Step3Page />} />
        <Route path="*"      element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
