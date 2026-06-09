import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, MapPin, Save, Trash2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AUTH_URL, PROJECTS_URL, MAP_URL, VIEWER_3D_URL } from "@shared/urls"

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
  [key: string]: number | string | undefined
  "프로젝트명"?: string
  "시추공명"?: string
  "상심도"?: number | string
  "하심도"?: number | string
  "지층명"?: string
  "경도"?: number | string
  "위도"?: number | string
  lon_wgs84?: number | string
  lat_wgs84?: number | string
  tm_x?: number | string
  tm_y?: number | string
  raw_x?: number | string
  raw_y?: number | string
  "표고"?: number | string
  meta_crs?: string
}

type CrsOption = {
  value: string
  label: string
  kind: "wgs84" | "grs80-tm" | "server"
  lon0?: number
  lat0?: number
  scaleFactor?: number
  falseEasting?: number
  falseNorthing?: number
}

const CRS_OPTIONS: CrsOption[] = [
  { value: "EPSG:5186", label: "GRS80 TM중부원점", kind: "grs80-tm", lon0: 127, falseNorthing: 600000 },
  { value: "EPSG:5187", label: "GRS80 TM동부원점", kind: "grs80-tm", lon0: 129, falseNorthing: 600000 },
  { value: "EPSG:5181", label: "GRS80 TM중부원점(500,000)", kind: "grs80-tm", lon0: 127, falseNorthing: 500000 },
  { value: "EPSG:5183", label: "GRS80 TM동부원점(500,000)", kind: "grs80-tm", lon0: 129, falseNorthing: 500000 },
  { value: "EPSG:4326", label: "WGS84 경위도", kind: "wgs84" },
  { value: "EPSG:5174", label: "Bessel TM중부원점", kind: "server" },
  { value: "EPSG:5176", label: "Bessel TM동부원점", kind: "server" },
]

type ManualUpload = {
  job_id: number
  status: JobStatus
  project_id: number
  auto_project: boolean
  page_count: number
}

type CoordinateConvertResponse = {
  raw_x: number | string
  raw_y: number | string
  source_crs: string | null
  lon_wgs84: number | string
  lat_wgs84: number | string
  tm_x: number | string
  tm_y: number | string
  meta_crs: string
  valid: boolean
  message?: string | null
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
        <a href={PROJECTS_URL} className="text-sm font-semibold text-foreground">
          GeoBIM Stratum
        </a>
        <nav className="flex items-center gap-1">
          {[
            { label: "프로젝트", href: PROJECTS_URL },
            { label: "지도", href: MAP_URL },
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
              window.location.href = AUTH_URL
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
  onReviewReadyChange,
}: {
  projects: Project[]
  loadingProjects: boolean
  lockedProjectId?: number
  returnUrl?: string
  onReviewReadyChange?: (ready: boolean) => void
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

  async function handleApprove(updatedRows: PreviewRow[]) {
    if (!job) return
    setSaving(true)
    setError(null)
    try {
      const saved = await apiPostJson<ExtractionJob>(`/api/v1/pdf-extraction/jobs/${job.id}/approve`, { rows: updatedRows })
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

  useEffect(() => {
    onReviewReadyChange?.(reviewReady)
  }, [reviewReady, onReviewReadyChange])

  return (
    <div className={cn("space-y-5", reviewReady && "grid gap-6 lg:grid-cols-[420px_1fr] lg:space-y-0")}>
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
                  href={VIEWER_3D_URL}
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

      {reviewReady && (
        <div className="min-w-0">
          <PreviewPanel key={job.id} job={job} saving={saving} onSave={handleApprove} />
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
  onSave: (updatedRows: PreviewRow[]) => void
}) {
  const [editedRows, setEditedRows] = useState<PreviewRow[]>(() => job.result?.rows ?? [])
  const [projectName, setProjectName] = useState(
    () => projectNameFromRows(job.result?.rows ?? []) ?? job.result?.project_name ?? "",
  )
  const [selectedBoreholeName, setSelectedBoreholeName] = useState<string | null>(null)

  const handleProjectNameChange = (value: string) => {
    setProjectName(value)
    setEditedRows((prev) => prev.map((row) => ({ ...row, "프로젝트명": value })))
  }

  const applyCoordinateConversion = (boreholeName: string, sourceRow: PreviewRow) => {
    void convertPreviewCoordinates(sourceRow)
      .then((converted) => {
        if (!converted) return
        setEditedRows((prev) =>
          prev.map((row, idx) =>
            previewBoreholeName(row, idx) === boreholeName
              ? {
                  ...row,
                  lon_wgs84: converted.lon_wgs84,
                  lat_wgs84: converted.lat_wgs84,
                  tm_x: converted.tm_x,
                  tm_y: converted.tm_y,
                  meta_crs: converted.meta_crs,
                }
              : row,
          ),
        )
      })
      .catch((err) => {
        console.warn("좌표 변환 API 호출 실패", err)
      })
  }

  const handleCellChange = (rowIndex: number, key: keyof PreviewRow, value: string) => {
    setSelectedBoreholeName(previewBoreholeName(editedRows[rowIndex] ?? {}, rowIndex))
    const sourceRowForConversion = { ...(editedRows[rowIndex] ?? {}), [key]: value }
    setEditedRows((prev) => {
      // 1. 숫자값 파싱 처리
      const isNumericField = ["lon_wgs84", "lat_wgs84", "상심도", "하심도", "표고"].includes(String(key))
      let parsedValue: any = value
      if (isNumericField && value !== "") {
        const num = Number(value.replace(/,/g, ""))
        if (!isNaN(num)) {
          parsedValue = num
        }
      }

      // 2. 시추공 메타데이터(시추공명, 위경도, 표고, 좌표계) 일괄 동기화 필드 여부
      const isBoreholeMetaField = ["시추공명", "lon_wgs84", "lat_wgs84", "표고", "meta_crs"].includes(String(key))
      let nextRows = [...prev]

      if (isBoreholeMetaField) {
        // 기존 시추공명을 기준으로 매칭하여 일괄 수정
        const targetBoreholeName = prev[rowIndex]["시추공명"]
        nextRows = prev.map((row, idx) => {
          if (row["시추공명"] === targetBoreholeName || idx === rowIndex) {
            const updatedRow = { ...row, [key]: parsedValue }
            return updatedRow
          }
          return row
        })
      } else {
        // 일반 셀은 단일 업데이트
        nextRows = prev.map((row, idx) => {
          if (idx === rowIndex) {
            return { ...row, [key]: parsedValue }
          }
          return row
        })
      }

      // 3. 지층 심도 경계면 연속성 동기화 (상위 지층의 하심도 <-> 하위 지층의 상심도)
      const currentBorehole = nextRows[rowIndex]["시추공명"]

      if (key === "하심도") {
        // 현재 행의 하심도가 바뀌면, 동일 시추공을 공유하는 다음 인덱스 행의 상심도를 자동 동기화
        if (rowIndex + 1 < nextRows.length && nextRows[rowIndex + 1]["시추공명"] === currentBorehole) {
          nextRows[rowIndex + 1] = {
            ...nextRows[rowIndex + 1],
            "상심도": parsedValue
          }
        }
      } else if (key === "상심도") {
        // 현재 행의 상심도가 바뀌면, 동일 시추공을 공유하는 이전 인덱스 행의 하심도를 자동 동기화
        if (rowIndex - 1 >= 0 && nextRows[rowIndex - 1]["시추공명"] === currentBorehole) {
          nextRows[rowIndex - 1] = {
            ...nextRows[rowIndex - 1],
            "하심도": parsedValue
          }
        }
      }

      return nextRows
    })
    if (key === "meta_crs") {
      applyCoordinateConversion(previewBoreholeName(sourceRowForConversion, rowIndex), sourceRowForConversion)
    }
  }

  const previewRows = editedRows.slice(0, 20)

  return (
    <div className="space-y-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-100">파싱 결과 확인</p>
          <p className="mt-1 text-xs text-sky-100/75">
            시추공 {job.result?.borehole_count ?? 0}개 · 지층 {job.result?.stratum_count ?? 0}개
          </p>
        </div>
        <Button
          className="gap-2"
          disabled={saving || editedRows.length === 0}
          onClick={() => onSave(rowsWithProjectName(editedRows, projectName))}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          저장
        </Button>
      </div>

      <div className="grid gap-3 rounded-md border border-sky-400/20 bg-background/60 p-3 text-xs sm:grid-cols-2">
        <div>
          <label htmlFor={`project-name-${job.id}`} className="text-muted-foreground">
            프로젝트명
          </label>
          <input
            id={`project-name-${job.id}`}
            type="text"
            value={projectName}
            placeholder="프로젝트명을 입력하세요"
            onChange={(event) => handleProjectNameChange(event.target.value)}
            className="mt-1 w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-foreground outline-none transition-all duration-150 hover:border-input focus:border-sky-500 focus:bg-background/80"
          />
        </div>
        <div>
          <p className="text-muted-foreground">저장 방식</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {projectName.trim() ? "해당 프로젝트로 저장 예정" : "저장 전 확인 필요"}
          </p>
        </div>
      </div>

      <CoordinatePreviewMap
        rows={editedRows}
        selectedName={selectedBoreholeName}
        onSelectPoint={setSelectedBoreholeName}
      />

      <div className="max-h-[360px] overflow-auto rounded-md border border-sky-400/20 bg-background/60">
        <table className="w-full min-w-[920px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              {["시추공", "상심도", "하심도", "지층", "경도", "위도", "표고", "좌표계"].map((header) => (
                <th key={header} className="border-b border-border px-3 py-2 font-medium whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, index) => {
              const boreholeName = previewBoreholeName(row, index)
              const selected = selectedBoreholeName === boreholeName
              return (
              <tr
                key={`${row["시추공명"] ?? "row"}-${index}`}
                onClick={() => setSelectedBoreholeName(boreholeName)}
                className={cn(
                  "border-b border-border/60 transition-colors",
                  selected && "bg-sky-500/10",
                )}
              >
                <td className="px-2 py-1 text-foreground">
                  <input
                    type="text"
                    value={row["시추공명"] ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "시추공명", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <input
                    type="text"
                    value={row["상심도"] ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "상심도", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <input
                    type="text"
                    value={row["하심도"] ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "하심도", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-foreground">
                  <input
                    type="text"
                    value={row["지층명"] ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "지층명", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <input
                    type="text"
                    value={row.lon_wgs84 ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "lon_wgs84", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <input
                    type="text"
                    value={row.lat_wgs84 ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "lat_wgs84", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <input
                    type="text"
                    value={row["표고"] ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "표고", e.target.value)}
                    className="w-full bg-transparent px-1 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <select
                    value={row.meta_crs ?? ""}
                    onFocus={() => setSelectedBoreholeName(boreholeName)}
                    onChange={(e) => handleCellChange(index, "meta_crs", e.target.value)}
                    className="w-full bg-transparent pl-1 pr-8 py-0.5 border border-transparent hover:border-input focus:border-sky-500 focus:bg-background/80 rounded outline-none text-foreground transition-all duration-150"
                  >
                    <option value="" className="bg-slate-900 text-slate-100">선택 없음</option>
                    {CRS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900 text-slate-100">
                        {option.label} ({option.value})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {editedRows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            표시할 파싱 결과가 없습니다.
          </div>
        )}
      </div>
      {editedRows.length > previewRows.length && (
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
  onReviewReadyChange,
}: {
  projects: Project[]
  loadingProjects: boolean
  lockedProjectId?: number
  returnUrl?: string
  onReviewReadyChange?: (ready: boolean) => void
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

  async function handleApprove(updatedRows: PreviewRow[]) {
    if (!job) return
    setSaving(true)
    setError(null)
    try {
      const saved = await apiPostJson<ExtractionJob>(`/api/v1/pdf-extraction/jobs/${job.id}/approve`, { rows: updatedRows })
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

  const reviewReady = job?.status === "awaiting_review"
  const wideLayout = Boolean(manualJob) || reviewReady

  useEffect(() => {
    onReviewReadyChange?.(wideLayout)
  }, [wideLayout, onReviewReadyChange])

  return (
    <div className={cn("space-y-5", reviewReady && "grid gap-6 lg:grid-cols-[420px_1fr] lg:space-y-0")}>
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
          <div className={cn("grid gap-4", reviewReady ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_260px]")}>
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

      {reviewReady && (
        <div className="min-w-0 lg:max-h-[850px] lg:overflow-y-auto">
          <PreviewPanel key={job.id} job={job} saving={saving} onSave={handleApprove} />
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
  const [autoReviewReady, setAutoReviewReady] = useState(false)
  const [manualReviewReady, setManualReviewReady] = useState(false)

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
    apiGet<Project[]>("/api/v1/projects/?has_bbox=true")
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

      <main className={cn("mx-auto space-y-6 px-4 py-8", (tab === "auto" && autoReviewReady) || (tab === "manual" && manualReviewReady) ? "max-w-[1600px]" : "max-w-2xl")}>
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
            onReviewReadyChange={setAutoReviewReady}
          />
        ) : (
          <ManualTab
            projects={projects}
            loadingProjects={loadingProjects}
            lockedProjectId={lockedProjectId}
            returnUrl={returnUrl}
            onReviewReadyChange={setManualReviewReady}
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

function projectNameFromRows(rows: PreviewRow[]) {
  for (const row of rows) {
    const name = String(row["프로젝트명"] ?? "").trim()
    if (name) return name
  }
  return null
}

function rowsWithProjectName(rows: PreviewRow[], projectName: string): PreviewRow[] {
  const trimmed = projectName.trim()
  if (!trimmed) return rows
  return rows.map((row) => ({ ...row, "프로젝트명": trimmed }))
}

async function convertPreviewCoordinates(row: PreviewRow): Promise<PreviewRow | null> {
  const crs = normalizeCrsValue(row.meta_crs)
  if (!crs) return null
  const source = sourceCoordinatesForConversion(row, crs)
  if (!source) return null

  const converted = await apiPostJson<CoordinateConvertResponse>("/api/v1/coordinates/convert", {
    x: source.x,
    y: source.y,
    source_crs: crs,
    borehole_id: String(row["?쒖텛怨듬챸"] ?? "preview"),
  })
  if (!converted.valid) return null
  return {
    ...row,
    lon_wgs84: converted.lon_wgs84,
    lat_wgs84: converted.lat_wgs84,
    tm_x: converted.tm_x,
    tm_y: converted.tm_y,
    meta_crs: converted.meta_crs,
  }
}

function sourceCoordinatesForConversion(row: PreviewRow, crs: string): { x: number; y: number } | null {
  const normalized = normalizeCrsValue(crs)
  const wgs84Candidates: Array<[unknown, unknown]> = [
    [row.raw_x, row.raw_y],
    [row["寃쎈룄"], row["?꾨룄"]],
    [row.lon_wgs84, row.lat_wgs84],
  ]
  const tmCandidates: Array<[unknown, unknown]> = [
    [row.raw_x, row.raw_y],
    [row["寃쎈룄"], row["?꾨룄"]],
    [row.tm_x, row.tm_y],
  ]
  const candidates = normalized === "EPSG:4326" || normalized === "WGS84" ? wgs84Candidates : tmCandidates

  for (const [rawX, rawY] of candidates) {
    const x = toNumber(rawX)
    const y = toNumber(rawY)
    if (x === null || y === null) continue
    if (normalized === "EPSG:4326" || normalized === "WGS84") {
      if (isWgs84Range(x, y)) return { x, y }
      continue
    }
    if (Math.max(Math.abs(x), Math.abs(y)) > 100000) {
      return { x, y }
    }
  }
  return null
}

function recalculatePreviewCoordinates(row: PreviewRow): PreviewRow {
  const crs = normalizeCrsValue(row.meta_crs)
  const option = CRS_OPTIONS.find((item) => item.value === crs)
  if (!option) return row

  if (option.kind === "wgs84") {
    const lon = toNumber(row.raw_x ?? row["경도"] ?? row.lon_wgs84)
    const lat = toNumber(row.raw_y ?? row["위도"] ?? row.lat_wgs84)
    if (lon === null || lat === null || !isWgs84Range(lon, lat)) return row
    return { ...row, lon_wgs84: roundCoordinate(lon), lat_wgs84: roundCoordinate(lat), meta_crs: option.value }
  }

  if (option.kind !== "grs80-tm" || option.lon0 === undefined || option.falseNorthing === undefined) {
    return { ...row, meta_crs: option.value }
  }

  const source = sourceTmCoordinates(row)
  if (!source) return { ...row, meta_crs: option.value }

  const [easting, northing] = source.x < source.y ? [source.x, source.y] : [source.y, source.x]
  const converted = grs80TmToWgs84(northing, easting, option)
  if (!converted) return { ...row, meta_crs: option.value }

  return {
    ...row,
    lon_wgs84: roundCoordinate(converted.lon),
    lat_wgs84: roundCoordinate(converted.lat),
    meta_crs: option.value,
  }
}

function normalizeCrsValue(value: unknown) {
  return String(value ?? "").replace(/_INFERRED$/, "")
}

function sourceTmCoordinates(row: PreviewRow): { x: number; y: number } | null {
  const candidates: Array<[unknown, unknown]> = [
    [row.raw_x, row.raw_y],
    [row["경도"], row["위도"]],
    [row.tm_x, row.tm_y],
    [row.lon_wgs84, row.lat_wgs84],
  ]

  for (const [rawX, rawY] of candidates) {
    const x = toNumber(rawX)
    const y = toNumber(rawY)
    if (x === null || y === null) continue
    if (Math.max(Math.abs(x), Math.abs(y)) > 100000) {
      return { x, y }
    }
  }
  return null
}

function grs80TmToWgs84(northing: number, easting: number, option: CrsOption): { lat: number; lon: number } | null {
  if (option.lon0 === undefined || option.falseNorthing === undefined) return null
  const a = 6378137.0
  const f = 1 / 298.257222101
  const centralMeridian = option.lon0
  const latitudeOfOrigin = option.lat0 ?? 38
  const scaleFactor = option.scaleFactor ?? 1
  const falseEasting = option.falseEasting ?? 200000
  const falseNorthing = option.falseNorthing
  const b = a * (1 - f)
  const e2 = (a ** 2 - b ** 2) / a ** 2
  const ep2 = (a ** 2 - b ** 2) / b ** 2
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi0 = degreesToRadians(latitudeOfOrigin)
  const lam0 = degreesToRadians(centralMeridian)
  const mo =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi0 -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi0) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi0) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi0))

  const m = mo + (northing - falseNorthing) / scaleFactor
  const phi1Init = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256))
  const phi1 =
    phi1Init +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * phi1Init) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * phi1Init) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * phi1Init) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * phi1Init)

  const r = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5
  const c = ep2 * Math.cos(phi1) ** 2
  const t = Math.tan(phi1) ** 2
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2)
  const d = (easting - falseEasting) / (n * scaleFactor)

  const latRad =
    phi1 -
    ((n * Math.tan(phi1)) / r) *
      (d ** 2 / 2 -
        (d ** 4 / 24) * (5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep2) +
        (d ** 6 / 720) * (61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep2 - 3 * c ** 2))
  const lon =
    radiansToDegrees(lam0) +
    radiansToDegrees(
      (1 / Math.cos(phi1)) *
        (d -
          (d ** 3 / 6) * (1 + 2 * t + c) +
          (d ** 5 / 120) * (5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep2 + 24 * t ** 2)),
    )
  const lat = radiansToDegrees(latRad)

  return isWgs84Range(lon, lat) ? { lat, lon } : null
}

function isWgs84Range(lon: number, lat: number) {
  return lon >= 120 && lon <= 135 && lat >= 30 && lat <= 45
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(7))
}

type PreviewPoint = {
  id: string
  name: string
  lon: number
  lat: number
  crs?: string
}

function CoordinatePreviewMap({
  rows,
  selectedName,
  onSelectPoint,
}: {
  rows: PreviewRow[]
  selectedName: string | null
  onSelectPoint: (name: string) => void
}) {
  const points = uniquePreviewPoints(rows)
  const [mapCenter, setMapCenter] = useState<PreviewPoint | null>(null)
  const [zoom, setZoom] = useState(14)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    centerWorld: { x: number; y: number }
  } | null>(null)

  const selectedPoint = selectedName ? points.find((point) => point.name === selectedName) ?? null : null

  // selectedName이 바뀔 때(새 시추공 선택)만 지도를 재중심한다.
  // selectedPoint?.id를 의존성으로 쓰면 좌표 편집 시마다 재중심되어
  // 핀이 항상 화면 중앙에 고정되고 "핀이 움직이지 않는" 것처럼 보인다.
  useEffect(() => {
    if (selectedPoint) {
      setMapCenter(selectedPoint)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName])

  if (points.length === 0) {
    return (
      <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
        좌표 위치 미리보기를 표시할 수 없습니다. 기준좌표계 또는 좌표값을 확인한 뒤 다시 파싱해 주세요.
      </div>
    )
  }

  const center = mapCenter ?? selectedPoint ?? averagePoint(points)
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom)
  const mapPlaneSize = 1280
  const mapCenterPx = mapPlaneSize / 2
  const tileX = Math.floor(centerWorld.x / 256)
  const tileY = Math.floor(centerWorld.y / 256)
  const offsetX = centerWorld.x - tileX * 256
  const offsetY = centerWorld.y - tileY * 256
  const tiles = [-2, -1, 0, 1, 2].flatMap((dy) =>
    [-2, -1, 0, 1, 2].map((dx) => ({
      key: `${dx}:${dy}`,
      x: tileX + dx,
      y: tileY + dy,
      left: mapCenterPx + dx * 256 - offsetX,
      top: mapCenterPx + dy * 256 - offsetY,
    })),
  )
  const coordinateGroups = new Map<string, PreviewPoint[]>()
  points.forEach((point) => {
    const key = `${point.lon.toFixed(7)}:${point.lat.toFixed(7)}`
    if (!coordinateGroups.has(key)) {
      coordinateGroups.set(key, [])
    }
    coordinateGroups.get(key)!.push(point)
  })

  const markers = points.map((point) => {
    const world = lonLatToWorld(point.lon, point.lat, zoom)
    let left = world.x - centerWorld.x + mapCenterPx
    let top = world.y - centerWorld.y + mapCenterPx

    const key = `${point.lon.toFixed(7)}:${point.lat.toFixed(7)}`
    const group = coordinateGroups.get(key) ?? []
    if (group.length > 1) {
      const idx = group.indexOf(point)
      const angle = (idx * 2 * Math.PI) / group.length
      const radius = 18
      left += radius * Math.cos(angle)
      top += radius * Math.sin(angle)
    }

    return {
      ...point,
      left,
      top,
    }
  })
  const crsLabels = Array.from(new Set(points.map((point) => point.crs).filter(Boolean)))

  function moveToPoint(point: PreviewPoint) {
    onSelectPoint(point.name)
    setMapCenter(point)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest("[data-map-marker]")) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerWorld,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const nextWorld = {
      x: drag.centerWorld.x - (event.clientX - drag.startX),
      y: drag.centerWorld.y - (event.clientY - drag.startY),
    }
    setMapCenter({
      id: "manual-map-center",
      name: "지도 중심",
      ...worldToLonLat(nextWorld.x, nextWorld.y, zoom),
    })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function changeZoom(nextZoom: number, anchorOffset?: { x: number; y: number }) {
    const clampedZoom = Math.min(18, Math.max(8, nextZoom))
    if (clampedZoom === zoom) return

    if (anchorOffset) {
      const anchorBefore = worldToLonLat(centerWorld.x + anchorOffset.x, centerWorld.y + anchorOffset.y, zoom)
      const anchorAfterWorld = lonLatToWorld(anchorBefore.lon, anchorBefore.lat, clampedZoom)
      const nextCenterWorld = {
        x: anchorAfterWorld.x - anchorOffset.x,
        y: anchorAfterWorld.y - anchorOffset.y,
      }
      setMapCenter({
        id: "zoom-map-center",
        name: "지도 중심",
        ...worldToLonLat(nextCenterWorld.x, nextCenterWorld.y, clampedZoom),
      })
    }

    setZoom(clampedZoom)
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    changeZoom(zoom + (event.deltaY < 0 ? 1 : -1), {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    })
  }

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
      <div
        className="relative h-56 cursor-grab overflow-hidden bg-[#d8e7d1] active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="absolute right-2 top-2 z-10 flex overflow-hidden rounded border border-slate-300 bg-white/90 shadow">
          <button
            type="button"
            onClick={() => changeZoom(zoom + 1, { x: -120, y: -60 })}
            className="h-7 w-7 border-r border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
            disabled={zoom >= 18}
            title="확대"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => changeZoom(zoom - 1, { x: -120, y: -60 })}
            className="h-7 w-7 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
            disabled={zoom <= 8}
            title="축소"
          >
            -
          </button>
        </div>
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: mapPlaneSize, height: mapPlaneSize }}
        >
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
              alt=""
              className="absolute h-64 w-64 select-none bg-[#d8e7d1]"
              draggable={false}
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              data-map-marker
              onClick={() => moveToPoint(marker)}
              className="absolute -translate-x-1/2 -translate-y-full focus:outline-none"
              style={{ left: marker.left, top: marker.top }}
              title={`${marker.name} (${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)})`}
            >
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mb-1 rounded px-1.5 py-0.5 text-[10px] font-medium shadow",
                    selectedName === marker.name ? "bg-amber-300 text-slate-950" : "bg-slate-950/90 text-sky-100",
                  )}
                >
                  {marker.name}
                </span>
                <MapPin
                  className={cn(
                    "h-6 w-6 drop-shadow",
                    selectedName === marker.name ? "fill-amber-300 text-slate-950" : "fill-sky-300 text-sky-950",
                  )}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 border-t border-sky-400/20 px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-2">
        <span>중심: {center.lat.toFixed(6)}, {center.lon.toFixed(6)} · 줌 {zoom}</span>
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

function worldToLonLat(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom
  const lon = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = radiansToDegrees(Math.atan(Math.sinh(n)))
  return { lon, lat }
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
