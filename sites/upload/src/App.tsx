import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Save, Trash2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

type Project = {
  id: number
  name: string
  region?: string | null
}

type JobStatus = "pending" | "running" | "awaiting_review" | "approved" | "failed"

type ExtractionJob = {
  id: number
  project_id: number
  status: JobStatus
  borehole_count: number
  result?: {
    project_name?: string
    borehole_count?: number
    stratum_count?: number
    rows?: PreviewRow[]
  } | null
  error?: string | null
}

type PreviewRow = {
  "프로젝트명"?: string
  "시추공명"?: string
  "상심도"?: number | string
  "하심도"?: number | string
  "지층명"?: string
  lon_wgs84?: number | string
  lat_wgs84?: number | string
  "표고"?: number | string
  meta_crs?: string
}

type ManualUpload = {
  job_id: number
  status: JobStatus
  project_id: number
  auto_project: boolean
  page_count: number
}

type ManualBox = {
  id: string
  label: ManualLabel
  page: number
  rect: [number, number, number, number]
}

type ManualLabel =
  | "project_name"
  | "borehole_name"
  | "coordinates"
  | "x_coord"
  | "y_coord"
  | "elevation"
  | "top_depth"
  | "bottom_depth"
  | "stratum_name"
  | "crs"

const MANUAL_LABELS: { value: ManualLabel; label: string }[] = [
  { value: "project_name", label: "프로젝트명" },
  { value: "borehole_name", label: "시추공명" },
  { value: "coordinates", label: "X/Y 좌표 묶음" },
  { value: "x_coord", label: "X 좌표" },
  { value: "y_coord", label: "Y 좌표" },
  { value: "elevation", label: "표고" },
  { value: "top_depth", label: "상심도 열" },
  { value: "bottom_depth", label: "하심도 열" },
  { value: "stratum_name", label: "지층명 열" },
  { value: "crs", label: "기준좌표계" },
]

function NavBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <a href="http://localhost:5171/" className="text-sm font-semibold text-foreground">
          GeoBIM Stratum
        </a>
        <nav className="flex items-center gap-1">
          {[
            { label: "프로젝트", href: "http://localhost:5171/" },
            { label: "지도", href: "http://localhost:5172/" },
            { label: "업로드", href: null },
          ].map(({ label, href }) =>
            href ? (
              <a
                key={label}
                href={href}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {label}
              </a>
            ) : (
              <span
                key={label}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {label}
              </span>
            ),
          )}
          <button
            onClick={() => {
              window.location.href = "http://localhost:5170/"
            }}
            className="ml-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            로그아웃
          </button>
        </nav>
      </div>
    </header>
  )
}

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
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
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
          <FileUp className="h-9 w-9 text-sky-300" />
          <div className="max-w-full text-center">
            <p className="break-all text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <p className="text-xs text-muted-foreground">클릭하거나 파일을 드래그해 교체</p>
        </>
      ) : (
        <>
          <UploadCloud className="h-9 w-9 text-sky-300" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">파일을 드래그하거나 클릭해 선택</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        </>
      )}
    </div>
  )
}

function AutoParseTab({
  projects,
  loadingProjects,
}: {
  projects: Project[]
  loadingProjects: boolean
}) {
  const [projectId, setProjectId] = useState<number | "">("")
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<ExtractionJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!job || !["pending", "running"].includes(job.status)) return
    const timer = window.setInterval(async () => {
      try {
        const next = await apiGet<ExtractionJob>(`/api/v1/pdf-extraction/jobs/${job.id}`)
        setJob(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : "작업 상태를 확인하지 못했습니다.")
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [job])

  async function handleStart() {
    if (!file) return
    setSubmitting(true)
    setError(null)
    setJob(null)

    try {
      const form = new FormData()
      if (projectId !== "") form.append("project_id", String(projectId))
      form.append("pdf_file", file)
      const created = await apiPostForm<{ job_id: number; status: JobStatus; auto_project: boolean }>(
        "/api/v1/pdf-extraction/upload",
        form,
      )
      setJob({ id: created.job_id, project_id: Number(projectId || 0), status: created.status, borehole_count: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드를 시작하지 못했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove() {
    if (!job) return
    setSaving(true)
    setError(null)
    try {
      const saved = await apiPost<ExtractionJob>(`/api/v1/pdf-extraction/jobs/${job.id}/approve`)
      setJob(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const busy = submitting || job?.status === "pending" || job?.status === "running"
  const reviewReady = job?.status === "awaiting_review"
  const complete = job?.status === "approved"

  return (
    <div className="space-y-5">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-foreground">저장 프로젝트</span>
        <select
          value={projectId}
          disabled={loadingProjects || busy}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">
            {loadingProjects ? "프로젝트 불러오는 중" : "문서에서 프로젝트명 자동 감지"}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <DropZone
        accept=".pdf,.docx,.hwpx"
        file={file}
        onFile={(f) => {
          setFile(f)
          setJob(null)
          setError(null)
        }}
        hint="PDF, DOCX, HWPX 지원"
      />

      <Button className="w-full gap-2" disabled={!file || busy} onClick={handleStart}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {buttonLabel({ busy, file, projectId })}
      </Button>

      {reviewReady && (
        <PreviewPanel job={job} saving={saving} onSave={handleApprove} />
      )}

      {complete && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            저장 완료
          </div>
          <p className="mt-1 text-xs text-emerald-200/80">
            {job.result?.project_name ? `${job.result.project_name}에 ` : ""}
            시추공 {job.borehole_count || job.result?.borehole_count || 0}개,
            지층 {job.result?.stratum_count || 0}개가 저장되었습니다.
          </p>
          <a
            href="http://localhost:5173/"
            className="mt-3 inline-flex text-xs font-medium text-emerald-100 underline-offset-4 hover:underline"
          >
            3D 뷰어에서 확인
          </a>
        </div>
      )}

      {(error || job?.status === "failed") && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            파싱 실패
          </div>
          <p className="mt-1 text-xs text-red-200/80">{error || job?.error}</p>
        </div>
      )}
    </div>
  )
}

function PreviewPanel({
  job,
  saving,
  onSave,
}: {
  job: ExtractionJob
  saving: boolean
  onSave: () => void
}) {
  const rows = job.result?.rows ?? []
  const previewRows = rows.slice(0, 20)

  return (
    <div className="space-y-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-100">파싱 결과 확인</p>
          <p className="mt-1 text-xs text-sky-100/75">
            시추공 {job.result?.borehole_count ?? 0}개 · 지층 {job.result?.stratum_count ?? 0}개
          </p>
        </div>
        <Button className="gap-2" disabled={saving || rows.length === 0} onClick={onSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          저장
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border border-sky-400/20 bg-background/60 p-3 text-xs sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">감지된 프로젝트명</p>
          <p className="mt-1 break-words text-sm font-medium text-foreground">
            {job.result?.project_name || "확인되지 않음"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">저장 방식</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {job.result?.project_name ? "해당 프로젝트로 저장 예정" : "저장 전 확인 필요"}
          </p>
        </div>
      </div>

      <div className="max-h-[360px] overflow-auto rounded-md border border-sky-400/20 bg-background/60">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              {["시추공", "상심도", "하심도", "지층", "경도", "위도", "표고", "좌표계"].map((header) => (
                <th key={header} className="border-b border-border px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, index) => (
              <tr key={`${row["시추공명"] ?? "row"}-${index}`} className="border-b border-border/60">
                <td className="px-3 py-2 text-foreground">{cell(row["시추공명"])}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row["상심도"])}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row["하심도"])}</td>
                <td className="px-3 py-2 text-foreground">{cell(row["지층명"])}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row.lon_wgs84)}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row.lat_wgs84)}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row["표고"])}</td>
                <td className="px-3 py-2 text-muted-foreground">{cell(row.meta_crs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            표시할 파싱 결과가 없습니다.
          </div>
        )}
      </div>
      {rows.length > previewRows.length && (
        <p className="text-xs text-sky-100/70">상위 {previewRows.length}개 행만 표시합니다.</p>
      )}
    </div>
  )
}

function ManualTab({
  projects,
  loadingProjects,
}: {
  projects: Project[]
  loadingProjects: boolean
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [projectId, setProjectId] = useState<number | "">("")
  const [file, setFile] = useState<File | null>(null)
  const [manualJob, setManualJob] = useState<ManualUpload | null>(null)
  const [job, setJob] = useState<ExtractionJob | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [boxes, setBoxes] = useState<ManualBox[]>([])
  const [activeLabel, setActiveLabel] = useState<ManualLabel>("bottom_depth")
  const [draftBox, setDraftBox] = useState<ManualBox | null>(null)
  const [drawingStart, setDrawingStart] = useState<[number, number] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFile(f: File) {
    setFile(f)
    setManualJob(null)
    setJob(null)
    setPageNumber(1)
    setBoxes([])
    setDraftBox(null)
    setError(null)
  }

  async function handleUpload() {
    if (!file) return
    setSubmitting(true)
    setError(null)
    setJob(null)
    try {
      const form = new FormData()
      if (projectId !== "") form.append("project_id", String(projectId))
      form.append("pdf_file", file)
      const created = await apiPostForm<ManualUpload>("/api/v1/pdf-extraction/manual/upload", form)
      setManualJob(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : "직접 지정 작업을 시작하지 못했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  function pointFromEvent(event: React.PointerEvent<HTMLDivElement>): [number, number] | null {
    const image = imageRef.current
    if (!image) return null
    const rect = image.getBoundingClientRect()
    const x = clamp((event.clientX - rect.left) / rect.width)
    const y = clamp((event.clientY - rect.top) / rect.height)
    return [x, y]
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!manualJob) return
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawingStart(point)
    setDraftBox({
      id: "draft",
      label: activeLabel,
      page: pageNumber,
      rect: [point[0], point[1], point[0], point[1]],
    })
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawingStart || !draftBox) return
    const point = pointFromEvent(event)
    if (!point) return
    setDraftBox({
      ...draftBox,
      rect: normalizedRect(drawingStart, point),
    })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftBox) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const [x0, y0, x1, y1] = draftBox.rect
    if (Math.abs(x1 - x0) > 0.01 && Math.abs(y1 - y0) > 0.01) {
      setBoxes((current) => [
        ...current,
        {
          ...draftBox,
          id: crypto.randomUUID(),
        },
      ])
    }
    setDrawingStart(null)
    setDraftBox(null)
  }

  async function handleExtract() {
    if (!manualJob) return
    setExtracting(true)
    setError(null)
    try {
      const next = await apiPostJson<ExtractionJob>(
        `/api/v1/pdf-extraction/jobs/${manualJob.job_id}/extract-boxes`,
        { box_definitions: { boxes } },
      )
      setJob(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "박스 영역을 추출하지 못했습니다.")
    } finally {
      setExtracting(false)
    }
  }

  async function handleApprove() {
    if (!job) return
    setSaving(true)
    setError(null)
    try {
      const saved = await apiPost<ExtractionJob>(`/api/v1/pdf-extraction/jobs/${job.id}/approve`)
      setJob(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const pageBoxes = boxes.filter((box) => box.page === pageNumber)
  const requiredReady = hasBox(boxes, "bottom_depth") && hasBox(boxes, "stratum_name")
  const pageImage = manualJob
    ? `${API_BASE}/api/v1/pdf-extraction/jobs/${manualJob.job_id}/pages/${pageNumber}.png`
    : null

  return (
    <div className="space-y-5">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-foreground">저장 프로젝트</span>
        <select
          value={projectId}
          disabled={loadingProjects || submitting || Boolean(manualJob)}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">
            {loadingProjects ? "프로젝트 불러오는 중" : "문서에서 프로젝트명 자동 감지"}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <DropZone accept=".pdf" file={file} onFile={handleFile} hint="PDF 파일만 지원" />

      <Button className="w-full gap-2" disabled={!file || submitting || Boolean(manualJob)} onClick={handleUpload}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        직접 지정 시작
      </Button>

      {manualJob && pageImage && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="overflow-hidden rounded-lg border border-border bg-card/40">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
                >
                  이전
                </Button>
                <span className="text-xs text-muted-foreground">
                  {pageNumber} / {manualJob.page_count}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageNumber >= manualJob.page_count}
                  onClick={() => setPageNumber((value) => Math.min(manualJob.page_count, value + 1))}
                >
                  다음
                </Button>
              </div>
              <span className="text-xs font-medium text-sky-200">
                {labelText(activeLabel)}
              </span>
            </div>

            <div
              className="relative max-h-[720px] touch-none overflow-auto bg-slate-950"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div className="relative mx-auto w-fit">
                <img
                  ref={imageRef}
                  src={pageImage}
                  alt="PDF 페이지"
                  draggable={false}
                  className="block max-w-full select-none"
                />
                {[...pageBoxes, ...(draftBox && draftBox.page === pageNumber ? [draftBox] : [])].map((box) => (
                  <div
                    key={box.id}
                    className={cn(
                      "pointer-events-none absolute border-2 bg-sky-400/20",
                      box.id === "draft" ? "border-amber-300" : "border-sky-300",
                    )}
                    style={boxStyle(box.rect)}
                  >
                    <span className="absolute left-0 top-0 max-w-full truncate bg-sky-950/90 px-1.5 py-0.5 text-[11px] font-medium text-sky-100">
                      {labelText(box.label)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">박스 라벨</span>
              <select
                value={activeLabel}
                onChange={(event) => setActiveLabel(event.target.value as ManualLabel)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {MANUAL_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="max-h-[260px] space-y-2 overflow-auto">
              {boxes.map((box) => (
                <div
                  key={box.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/70 px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{labelText(box.label)}</p>
                    <p className="text-[11px] text-muted-foreground">페이지 {box.page}</p>
                  </div>
                  <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setBoxes((current) => current.filter((item) => item.id !== box.id))}
                    title="삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {boxes.length === 0 && (
                <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                  지정된 박스가 없습니다.
                </div>
              )}
            </div>

            <Button className="w-full gap-2" disabled={!requiredReady || extracting} onClick={handleExtract}>
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              박스 영역 추출
            </Button>
          </div>
        </div>
      )}

      {job?.status === "awaiting_review" && (
        <PreviewPanel job={job} saving={saving} onSave={handleApprove} />
      )}

      {job?.status === "approved" && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            저장 완료
          </div>
          <p className="mt-1 text-xs text-emerald-200/80">
            {job.result?.project_name ? `${job.result.project_name}에 ` : ""}
            시추공 {job.borehole_count || job.result?.borehole_count || 0}개,
            지층 {job.result?.stratum_count || 0}개가 저장되었습니다.
          </p>
        </div>
      )}

      {(error || job?.status === "failed") && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            직접 지정 실패
          </div>
          <p className="mt-1 text-xs text-red-200/80">{error || job?.error}</p>
        </div>
      )}
    </div>
  )
}

type Tab = "auto" | "manual"

const TABS: { value: Tab; label: string }[] = [
  { value: "auto", label: "자동 파싱" },
  { value: "manual", label: "직접 지정" },
]

export default function App() {
  const [tab, setTab] = useState<Tab>("auto")
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectError, setProjectError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    apiGet<Project[]>("/api/v1/projects/")
      .then((data) => {
        if (mounted) setProjects(data)
      })
      .catch((err) => {
        if (mounted) setProjectError(err instanceof Error ? err.message : "프로젝트를 불러오지 못했습니다.")
      })
      .finally(() => {
        if (mounted) setLoadingProjects(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />
      <main className={cn("mx-auto space-y-6 px-4 py-8", tab === "manual" ? "max-w-6xl" : "max-w-2xl")}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PDF 업로드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            시추 주상도 문서를 업로드하여 지층 데이터를 추출합니다.
          </p>
        </div>

        <div className="flex rounded-lg border border-border bg-card/40 p-1">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {projectError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {projectError}
          </div>
        )}

        {tab === "auto" ? (
          <AutoParseTab projects={projects} loadingProjects={loadingProjects} />
        ) : (
          <ManualTab projects={projects} loadingProjects={loadingProjects} />
        )}
      </main>
    </div>
  )
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" })
  return parseResponse<T>(response)
}

async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    body,
  })
  return parseResponse<T>(response)
}

async function apiPost<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
  })
  return parseResponse<T>(response)
}

async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return parseResponse<T>(response)
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  let message = `요청 실패 (${response.status})`
  try {
    const body = await response.json()
    message = body.detail ?? message
  } catch {
    // Keep status-based message.
  }
  throw new Error(message)
}

function buttonLabel({
  busy,
  file,
  projectId,
}: {
  busy: boolean
  file: File | null
  projectId: number | ""
}) {
  if (busy) return "변환 중"
  if (!file) return "파일을 선택하세요"
  if (projectId === "") return "프로젝트명 자동 감지로 변환 시작"
  return "변환 시작"
}

function cell(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  return String(value)
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function normalizedRect(start: [number, number], end: [number, number]): [number, number, number, number] {
  return [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ]
}

function boxStyle(rect: [number, number, number, number]): CSSProperties {
  const [x0, y0, x1, y1] = rect
  return {
    left: `${x0 * 100}%`,
    top: `${y0 * 100}%`,
    width: `${(x1 - x0) * 100}%`,
    height: `${(y1 - y0) * 100}%`,
  }
}

function labelText(label: ManualLabel) {
  return MANUAL_LABELS.find((item) => item.value === label)?.label ?? label
}

function hasBox(boxes: ManualBox[], label: ManualLabel) {
  return boxes.some((box) => box.label === label)
}
