import { useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PreviewRow, ExtractionJob } from "../lib/types"
import { CRS_OPTIONS } from "../lib/constants"
import {
  projectNameFromRows,
  previewBoreholeName,
  convertPreviewCoordinates,
  rowsWithProjectName,
} from "../lib/helpers"
import { CoordinatePreviewMap } from "./CoordinatePreviewMap"

export function PreviewPanel({
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
              )
            })}
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
