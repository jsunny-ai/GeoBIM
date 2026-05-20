import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── 네비게이션 바 ────────────────────────────────────────────────────
function NavBar() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <a
          href="http://localhost:5171/"
          className="text-sm font-semibold text-foreground"
        >
          GeoBIM Stratum
        </a>
        <nav className="flex items-center gap-1">
          {[
            { label: "프로젝트", href: "http://localhost:5171/" },
            { label: "지도",     href: "http://localhost:5172/" },
            { label: "업로드",   href: null },
          ].map(({ label, href }) => (
            href ? (
              <a
                key={label}
                href={href}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {label}
              </a>
            ) : (
              <span
                key={label}
                className="rounded-md px-3 py-1.5 text-xs font-medium bg-accent text-foreground"
              >
                {label}
              </span>
            )
          ))}
          <button
            onClick={() => { window.location.href = "http://localhost:5170/" }}
            className="ml-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            로그아웃
          </button>
        </nav>
      </div>
    </header>
  )
}

// ─── 공통: 드래그앤드롭 영역 ──────────────────────────────────────────
function DropZone({
  accept,
  file,
  onFile,
  hint,
}: {
  accept: string
  file: File | null
  onFile: (f: File) => void
  hint: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) onFile(f)
    },
    [onFile],
  )

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3",
        "rounded-xl border-2 border-dashed p-10 transition-colors",
        dragging
          ? "border-sky-400 bg-sky-400/10"
          : "border-border bg-card/40 hover:border-sky-400/50 hover:bg-card/60",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
      {file ? (
        <>
          <span className="text-3xl">📄</span>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <p className="text-xs text-muted-foreground">클릭하거나 파일을 드래그해 교체</p>
        </>
      ) : (
        <>
          <span className="text-3xl">📂</span>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">파일을 드래그하거나 클릭해 선택</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        </>
      )}
    </div>
  )
}

// ─── 탭 A: 자동 파싱 ─────────────────────────────────────────────────
function AutoParseTab() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  function handleStart() {
    if (!file) return
    setLoading(true)
    setDone(false)
    setTimeout(() => {
      setLoading(false)
      setDone(true)
    }, 3000)
  }

  return (
    <div className="space-y-6">
      <DropZone
        accept=".pdf,.docx,.hwpx"
        file={file}
        onFile={(f) => { setFile(f); setDone(false) }}
        hint="PDF · DOCX · HWPX 지원"
      />

      <Button
        className="w-full"
        disabled={!file || loading}
        onClick={handleStart}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
            </svg>
            변환 중…
          </span>
        ) : (
          "변환 시작"
        )}
      </Button>

      {done && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          ✓ 파싱 완료. 결과를 확인하세요.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-1">안내</p>
        <ul className="list-disc list-inside space-y-1">
          <li>시추 주상도 PDF · DOCX · HWPX 파일을 업로드합니다.</li>
          <li>자동 파싱은 표준 양식 문서에 최적화되어 있습니다.</li>
          <li>비표준 양식은 "직접 지정" 탭을 이용하세요.</li>
        </ul>
      </div>
    </div>
  )
}

// ─── 탭 B: 직접 지정 ─────────────────────────────────────────────────
function ManualTab() {
  const [file, setFile] = useState<File | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  function handleFile(f: File) {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    setFile(f)
    setObjectUrl(URL.createObjectURL(f))
  }

  return (
    <div className="space-y-6">
      <DropZone
        accept=".pdf"
        file={file}
        onFile={handleFile}
        hint="PDF 파일만 지원"
      />

      {file && objectUrl && (
        <div className="relative overflow-hidden rounded-xl border border-border bg-card/40">
          {/* 기능 예정 배너 */}
          <div className="absolute inset-x-0 top-0 z-10 bg-amber-500/90 px-4 py-2 text-center text-xs font-medium text-amber-950 backdrop-blur-sm">
            박스 그리기 기능은 다음 버전에서 제공됩니다
          </div>
          {/* PDF iframe 미리보기 */}
          <div className="pt-10">
            <iframe
              src={`${objectUrl}#toolbar=0&navpanes=0&scrollbar=0`}
              className="h-[520px] w-full"
              title="PDF 미리보기"
            />
          </div>
        </div>
      )}

      {!file && (
        <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">안내</p>
          <ul className="list-disc list-inside space-y-1">
            <li>PDF를 업로드하면 첫 페이지 미리보기가 표시됩니다.</li>
            <li>박스 그리기로 지층 정보 영역을 직접 지정합니다.</li>
            <li>박스 그리기 기능은 다음 버전에서 제공될 예정입니다.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── 메인 ─────────────────────────────────────────────────────────────
type Tab = "auto" | "manual"

const TABS: { value: Tab; label: string }[] = [
  { value: "auto",   label: "자동 파싱" },
  { value: "manual", label: "직접 지정" },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("auto")

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PDF 업로드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            시추 주상도 문서를 업로드하여 지층 데이터를 추출합니다.
          </p>
        </div>

        {/* 탭 헤더 */}
        <div className="flex rounded-lg border border-border bg-card/40 p-1">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "auto" ? <AutoParseTab /> : <ManualTab />}
      </div>
    </div>
  )
}
