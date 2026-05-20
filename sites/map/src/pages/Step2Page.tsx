import { useNavigate } from "react-router-dom"

/**
 * Step2: 지형 솔리드 뷰어
 *
 * TODO (Task #8):
 *   - AWS Terrain Tiles fetch → terrarium 디코딩 → NaN 채움
 *   - IDW로 시추공 표고 잔차 보정
 *   - Three.js BufferGeometry 닫힌 솔리드 (상면 + 4벽 + 바닥)
 *   - V-World 텍스처 드레이프
 */
export default function Step2Page() {
  const navigate = useNavigate()
  const params   = window.location.search  // bbox, polygon 등 그대로 전달

  return (
    <div
      style={{
        height: "100vh",
        background: "#0a0e1a",
        color: "#e8e8e8",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{ fontSize: 13, color: "#8a9bb8" }}>GeoBIM Stratum · 2단계</div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>지형 솔리드 뷰어</h1>
      <p style={{ fontSize: 13, color: "#8a9bb8", margin: "4px 0 20px" }}>
        AWS Terrain + IDW 보정 → Three.js 닫힌 솔리드 (구현 예정)
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => navigate("/" + params)}
          style={{
            padding: "8px 18px", borderRadius: 8, background: "#1a2030",
            color: "#cbd5e1", border: "1px solid #3a4a6a", fontSize: 13, cursor: "pointer",
          }}
        >
          ← 1단계로
        </button>
        <button
          onClick={() => navigate("/step3" + params)}
          style={{
            padding: "8px 18px", borderRadius: 8, background: "#2473bd",
            color: "#fff", border: "1px solid #3084d0", fontSize: 13,
            fontWeight: 600, cursor: "pointer",
          }}
        >
          3단계로 →
        </button>
      </div>
    </div>
  )
}
