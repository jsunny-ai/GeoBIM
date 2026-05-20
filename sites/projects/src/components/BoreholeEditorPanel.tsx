import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { useUpdateBorehole } from "@/features/boreholes/hooks"
import type { Borehole, Stratum } from "@/lib/types"

const SOIL_TYPES = ["토사", "매립토", "퇴적토", "풍화토", "풍화암", "연암", "리핑암", "경암", "보통암", "발파암"]

interface Props {
  borehole: Borehole
  onClose: () => void
}

type DraftStratum = Omit<Stratum, "id">

export default function BoreholeEditorPanel({ borehole, onClose }: Props) {
  const update = useUpdateBorehole(borehole.id)

  const [lat, setLat] = useState(String(borehole.latitude))
  const [lng, setLng] = useState(String(borehole.longitude))
  const [elev, setElev] = useState(String(borehole.elevation ?? ""))
  const [strata, setStrata] = useState<DraftStratum[]>(
    borehole.strata.map(({ depth_top, depth_bottom, soil_type, order }) => ({
      depth_top,
      depth_bottom,
      soil_type,
      order,
    })),
  )

  function addStratum() {
    const lastBottom = strata[strata.length - 1]?.depth_bottom ?? 0
    setStrata([...strata, { order: strata.length, depth_top: lastBottom, depth_bottom: lastBottom + 1, soil_type: "토사" }])
  }

  function removeStratum(i: number) {
    setStrata(strata.filter((_, idx) => idx !== i))
  }

  function updateStratum(i: number, field: keyof DraftStratum, value: string | number) {
    setStrata(strata.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }

  async function handleSave() {
    const latitude = parseFloat(lat)
    const longitude = parseFloat(lng)
    const elevation = elev ? parseFloat(elev) : undefined

    await update.mutateAsync({
      latitude,
      longitude,
      elevation,
      strata: strata.map((s, i) => ({ ...s, order: i })),
    })
    onClose()
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">위도</Label>
          <Input value={lat} onChange={(e) => setLat(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">경도</Label>
          <Input value={lng} onChange={(e) => setLng(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">표고(m)</Label>
          <Input value={elev} onChange={(e) => setElev(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">지층</span>
          <Button size="sm" variant="outline" onClick={addStratum} className="h-6 text-xs px-2">
            + 지층 추가
          </Button>
        </div>

        <div className="space-y-1">
          {strata.map((s, i) => (
            <div key={i} className="flex gap-1 items-center">
              <Input
                value={s.depth_top}
                onChange={(e) => updateStratum(i, "depth_top", parseFloat(e.target.value) || 0)}
                className="h-7 text-xs w-16"
                placeholder="상심도"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <Input
                value={s.depth_bottom}
                onChange={(e) => updateStratum(i, "depth_bottom", parseFloat(e.target.value) || 0)}
                className="h-7 text-xs w-16"
                placeholder="하심도"
              />
              <Select
                value={s.soil_type}
                onChange={(e) => updateStratum(i, "soil_type", e.target.value)}
                className="h-7 text-xs flex-1"
              >
                {SOIL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeStratum(i)}
                className="h-7 w-7 text-destructive hover:text-destructive"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2 border-t border-border">
        <Button
          onClick={handleSave}
          disabled={update.isPending}
          className="flex-1 h-8 text-xs"
        >
          {update.isPending ? "저장 중…" : "저장"}
        </Button>
        <Button variant="outline" onClick={onClose} className="h-8 text-xs">
          취소
        </Button>
      </div>
    </div>
  )
}
