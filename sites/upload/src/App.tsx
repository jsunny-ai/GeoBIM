import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, MapPin, Save, Trash2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const API_BASE = import.meta.env.VITE_API_URL ?? ""

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
  template: ManualTemplate
  page: number
  rect: [number, number, number, number]
}

type ManualTemplate = "first" | "continuation"
type PageMode = "same" | "split"

const MANUAL_TEMPLATES: { value: ManualTemplate; label: string }[] = [
  { value: "first", label: "첫 페이지 형식" },
  { value: "continuation", label: "연속 페이지 형식" },
]

const PAGE_MODES: { value: PageMode; label: string }[] = [
  { value: "same", label: "모든 페이지 동일 형식" },
  { value: "split", label: "첫 페이지/연속 페이지 분리" },
]

type ManualLabel =
  | "project_name"
  | "borehole_name"
  | "coordinates"
  | "x_coord"
  | "y_coord"
  | "elevation"
  | "depth"
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
  { value: "depth", label: "심도 열" },
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
  lockedProjectId,
  returnUrl,
}: {
  projects: Project[]
  loadingProjects: boolean
  lockedProjectId?: number
  returnUrl?: string
}) {
  const [projectId, setProjectId] = useState<number | "">(lockedProjectId ?? "")
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
      // lockedProjectId가 있으면 신규 보완 시추공으로 마킹
      if (lockedProjectId) form.append("is_supplementary", "true")
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
          disabled={loadingProjects || busy || !!lockedProjectId}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed"
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
        {lockedProjectId && (
          <p className="text-xs text-sky-300 mt-1">
            ✓ 프로젝트가 고정되어 있습니다. 저장 후 시추 관리 탭으로 돌아가세요.
          </p>
        )}
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
          <div className="mt-3 flex gap-3">
            {returnUrl ? (
              <a
                href={returnUrl}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                ← 시추 관리로 돌아가기
              </a>
            ) : (
              <a
                href="http://localhost:5173/"
                className="text-xs font-medium text-emerald-100 underline-offset-4 hover:underline"
              >
                3D 뷰어에서 확인
              </a>
            )}
          </div>
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

      <CoordinatePreviewMap rows={rows} />

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
  lockedProjectId,
  returnUrl,
}: {
  projects: Project[]
  loadingProjects: boolean
  lockedProjectId?: number
  returnUrl?: string
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [projectId, setProjectId] = useState<number | "">(lockedProjectId ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [manualJob, setManualJob] = useState<ManualUpload | null>(null)
  const [job, setJob] = useState<ExtractionJob | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [boxes, setBoxes] = useState<ManualBox[]>([])
  const [pageMode, setPageMode] = useState<PageMode>("split")
  const [activeTemplate, setActiveTemplate] = useState<ManualTemplate>("first")
  const [activeLabel, setActiveLabel] = useState<ManualLabel>("depth")
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
      template: activeTemplate,
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
        {
          box_definitions: {
            mode: "auto_borehole_pages",
            page_mode: pageMode,
            first_page_detector: "borehole_name",
            boxes: boxes.filter((box) => pageMode === "split" || box.template === "first"),
          },
        },
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

  const pageBoxes = boxes.filter((box) => box.page === pageNumber && box.template === activeTemplate)
  const firstBoxes = boxes.filter((box) => box.template === "first")
  const continuationBoxes = boxes.filter((box) => box.template === "continuation")
  const requiredReady = pageMode === "same"
    ? hasBox(firstBoxes, "borehole_name") && hasBox(firstBoxes, "depth") && hasBox(firstBoxes, "stratum_name")
    : hasBox(firstBoxes, "borehole_name") &&
      hasBox(firstBoxes, "depth") &&
      hasBox(firstBoxes, "stratum_name") &&
      hasBox(continuationBoxes, "depth") &&
      hasBox(continuationBoxes, "stratum_name")
  const pageImage = manualJob
    ? `${API_BASE}/api/v1/pdf-extraction/jobs/${manualJob.job_id}/pages/${pageNumber}.png`
    : null

  return (
    <div className="space-y-5">
      <label className="block space-y-2">
        <span className="text-sm font-medium text-foreground">저장 프로젝트</span>
        <select
          value={projectId}
          disabled={loadingProjects || submitting || Boolean(manualJob) || !!lockedProjectId}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed"
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
        {lockedProjectId && (
          <p className="text-xs text-sky-300 mt-1">
            ✓ 프로젝트가 고정되어 있습니다. 저장 후 시추 관리 탭으로 돌아가세요.
          </p>
        )}
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
              <span className="text-xs font-medium text-muted-foreground">페이지 처리 방식</span>
              <select
                value={pageMode}
                onChange={(event) => {
                  const nextMode = event.target.value as PageMode
                  setPageMode(nextMode)
                  if (nextMode === "same") setActiveTemplate("first")
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {PAGE_MODES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
              {MANUAL_TEMPLATES.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setActiveTemplate(item.value)}
                  disabled={pageMode === "same" && item.value === "continuation"}
                  className={cn(
                    "rounded px-2 py-1.5 text-xs font-medium transition-colors",
                    activeTemplate === item.value
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                    pageMode === "same" && item.value === "continuation" && "cursor-not-allowed opacity-40",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

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
                    <p className="text-[11px] text-muted-foreground">
                      {templateText(box.template)} · 페이지 {box.page}
                    </p>
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
          {returnUrl && (
            <div className="mt-3">
              <a
                href={returnUrl}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                ← 시추 관리로 돌아가기
              </a>
            </div>
          )}
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

  // URL 파라미터: project_id (잠금), return_url (완료 후 복귀)
  const urlParams = new URLSearchParams(window.location.search)
  const lockedProjectId = urlParams.get("project_id") ? Number(urlParams.get("project_id")) : undefined
  const returnUrl = urlParams.get("return_url") ?? undefined

  useEffect(() => {
    if (lockedProjectId) {
      setProjects([{ id: lockedProjectId, name: `Project #${lockedProjectId}` }])
      setLoadingProjects(false)
      setProjectError(null)
      return
    }

    let mounted = true
    apiGet<Project[]>("/api/v1/projects?has_bbox=true")
      .then((data) => {
        if (mounted) setProjects(data)
      })
      .catch((err) => {
        if (mounted) {
          console.warn("프로젝트 목록을 불러오지 못했습니다.", err)
          setProjects([])
          setProjectError(null)
        }
      })
      .finally(() => {
        if (mounted) setLoadingProjects(false)
      })
    return () => {
      mounted = false
    }
  }, [lockedProjectId])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />

      {/* 프로젝트 연동 배너 */}
      {lockedProjectId && (
        <div className="border-b border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 flex items-center justify-between">
          <span>
            시추 관리에서 연동됨 — 저장된 데이터는 해당 프로젝트에 자동 반영됩니다.
          </span>
          {returnUrl && (
            <a
              href={returnUrl}
              className="text-xs text-sky-100 hover:underline underline-offset-2"
            >
              ← 시추 관리로 돌아가기
            </a>
          )}
        </div>
      )}

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
          <AutoParseTab
            projects={projects}
            loadingProjects={loadingProjects}
            lockedProjectId={lockedProjectId}
            returnUrl={returnUrl}
          />
        ) : (
          <ManualTab
            projects={projects}
            loadingProjects={loadingProjects}
            lockedProjectId={lockedProjectId}
            returnUrl={returnUrl}
          />
        )}
      </main>
    </div>
  )
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>("GET", path)
}

async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  return apiRequest<T>("POST", path, body)
}

async function apiPost<T>(path: string): Promise<T> {
  return apiRequest<T>("POST", path)
}

async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>("POST", path, JSON.stringify(body), "application/json")
}

function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: XMLHttpRequestBodyInit,
  contentType?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(method, `${API_BASE}${path}`, true)
    request.withCredentials = true
    if (contentType) request.setRequestHeader("Content-Type", contentType)

    request.onload = () => {
      const text = request.responseText || "null"
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(text) as T)
        } catch {
          resolve(null as T)
        }
        return
      }

      reject(new Error(parseErrorMessage(request.status, text)))
    }

    request.onerror = () => {
      reject(new Error("API request failed. Check that the backend is running and CORS allows this origin."))
    }

    request.send(body)
  })
}

function parseErrorMessage(status: number, text: string) {
  let message = `요청 실패 (${status})`
  try {
    const body = JSON.parse(text)
    message = body.detail ?? message
  } catch {
    // Keep status-based message.
  }
  if (
    message.includes("Connect call failed") ||
    message.includes("connection refused") ||
    message.includes("ECONNREFUSED")
  ) {
    return "데이터베이스에 연결할 수 없습니다. PostgreSQL(127.0.0.1:5432)을 먼저 실행한 뒤 다시 시도해 주세요."
  }
  return message
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

type PreviewPoint = {
  id: string
  name: string
  lon: number
  lat: number
  crs?: string
}

function CoordinatePreviewMap({ rows }: { rows: PreviewRow[] }) {
  const points = uniquePreviewPoints(rows)
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
        좌표 위치 미리보기를 표시할 수 없습니다. 기준좌표계 또는 좌표값을 확인한 뒤 다시 파싱해 주세요.
      </div>
    )
  }

  const center = averagePoint(points)
  const zoom = 14
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom)
  const tileX = Math.floor(centerWorld.x / 256)
  const tileY = Math.floor(centerWorld.y / 256)
  const offsetX = centerWorld.x - tileX * 256
  const offsetY = centerWorld.y - tileY * 256
  const tiles = [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].map((dx) => ({
      key: `${dx}:${dy}`,
      x: tileX + dx,
      y: tileY + dy,
      left: 128 + dx * 256 - offsetX,
      top: 128 + dy * 256 - offsetY,
    })),
  )
  const markers = points.map((point) => {
    const world = lonLatToWorld(point.lon, point.lat, zoom)
    return {
      ...point,
      left: world.x - centerWorld.x + 384,
      top: world.y - centerWorld.y + 384,
    }
  })
  const crsLabels = Array.from(new Set(points.map((point) => point.crs).filter(Boolean)))

  return (
    <div className="overflow-hidden rounded-md border border-sky-400/20 bg-background/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-400/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-sky-300" />
          <span className="text-xs font-medium text-foreground">좌표 위치 미리보기</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {points.length}개 시추공 {crsLabels.length ? `· ${crsLabels.join(", ")}` : ""}
        </span>
      </div>
      <div className="relative h-56 overflow-hidden bg-slate-950">
        <div className="absolute left-1/2 top-1/2 h-[768px] w-[768px] -translate-x-1/2 -translate-y-1/2">
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
              alt=""
              className="absolute h-64 w-64 select-none"
              draggable={false}
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          {markers.map((marker) => (
            <div
              key={marker.id}
              className="absolute -translate-x-1/2 -translate-y-full"
              style={{ left: marker.left, top: marker.top }}
              title={`${marker.name} (${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)})`}
            >
              <div className="flex flex-col items-center">
                <span className="mb-1 rounded bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-medium text-sky-100 shadow">
                  {marker.name}
                </span>
                <MapPin className="h-6 w-6 fill-sky-300 text-sky-950 drop-shadow" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-2 border-t border-sky-400/20 px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-2">
        <span>중심: {center.lat.toFixed(6)}, {center.lon.toFixed(6)}</span>
        <span>위치가 현장과 다르면 기준좌표계를 수정해서 다시 확인하세요.</span>
      </div>
    </div>
  )
}

function uniquePreviewPoints(rows: PreviewRow[]): PreviewPoint[] {
  const points = new Map<string, PreviewPoint>()
  rows.forEach((row, index) => {
    const lon = toNumber(row.lon_wgs84)
    const lat = toNumber(row.lat_wgs84)
    if (lon === null || lat === null) return
    if (lon < 120 || lon > 135 || lat < 30 || lat > 45) return
    const name = previewBoreholeName(row, index)
    const key = `${name}:${lon.toFixed(7)}:${lat.toFixed(7)}`
    if (!points.has(key)) {
      points.set(key, {
        id: key,
        name,
        lon,
        lat,
        crs: row.meta_crs ? String(row.meta_crs) : undefined,
      })
    }
  })
  return Array.from(points.values())
}

function previewBoreholeName(row: PreviewRow, index: number) {
  const record = row as Record<string, unknown>
  const direct = record["시추공명"] ?? record["borehole_name"]
  if (direct) return String(direct)
  const fuzzyKey = Object.keys(record).find((key) => key.includes("시추") || key.includes("怨듬챸"))
  const fuzzyValue = fuzzyKey ? record[fuzzyKey] : null
  return fuzzyValue ? String(fuzzyValue) : `BH-${index + 1}`
}

function averagePoint(points: PreviewPoint[]) {
  const total = points.reduce(
    (acc, point) => ({ lon: acc.lon + point.lon, lat: acc.lat + point.lat }),
    { lon: 0, lat: 0 },
  )
  return { lon: total.lon / points.length, lat: total.lat / points.length }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(String(value).replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const scale = 256 * 2 ** zoom
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
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

function templateText(template: ManualTemplate) {
  return MANUAL_TEMPLATES.find((item) => item.value === template)?.label ?? template
}

function hasBox(boxes: ManualBox[], label: ManualLabel) {
  return boxes.some((box) => box.label === label)
}
