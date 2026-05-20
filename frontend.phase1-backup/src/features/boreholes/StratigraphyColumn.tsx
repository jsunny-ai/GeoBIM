import { getStrataColor, STRATA_LEGEND } from "@/lib/strataColor"
import type { Borehole } from "@/mock/data"

const COLUMN_H = 600

interface Props {
  borehole: Borehole
}

export default function StratigraphyColumn({ borehole }: Props) {
  const { strata, elevation } = borehole
  const totalDepth = strata[strata.length - 1]?.depth_bottom ?? 1

  const ticks = buildTicks(totalDepth)

  return (
    <div className="flex gap-6">
      {/* Depth scale */}
      <div className="relative w-12 shrink-0" style={{ height: COLUMN_H }}>
        {ticks.map((d) => {
          const top = (d / totalDepth) * COLUMN_H
          return (
            <div
              key={d}
              className="absolute right-0 flex items-center gap-1"
              style={{ top }}
            >
              <span className="text-[11px] leading-none text-muted-foreground">
                {d}m
              </span>
              <div className="h-px w-2 bg-border" />
            </div>
          )
        })}
        {/* Bottom tick */}
        <div className="absolute right-0 bottom-0 flex items-center gap-1">
          <span className="text-[11px] leading-none text-muted-foreground">
            {totalDepth}m
          </span>
          <div className="h-px w-2 bg-border" />
        </div>
      </div>

      {/* Column */}
      <div className="flex w-36 shrink-0 flex-col" style={{ height: COLUMN_H }}>
        {strata.map((s, i) => {
          const proportion = (s.depth_bottom - s.depth_top) / totalDepth
          const blockH = Math.max(proportion * COLUMN_H, 24)
          const color = getStrataColor(s.soil_type)

          return (
            <div
              key={i}
              className="flex shrink-0 flex-col justify-center overflow-hidden border-b border-black/10 px-2 py-0.5"
              style={{ height: blockH, backgroundColor: color }}
            >
              <p className="truncate text-xs font-semibold text-slate-900">
                {s.soil_type}
              </p>
              <p className="text-[11px] text-slate-800/80">
                {s.depth_top}~{s.depth_bottom}m
              </p>
            </div>
          )
        })}
      </div>

      {/* Metadata + legend */}
      <div className="flex flex-col gap-6">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">표고</p>
          <p className="text-sm font-medium">{elevation} m</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">총 심도</p>
          <p className="text-sm font-medium">{totalDepth} m</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">범례</p>
          {STRATA_LEGEND.map((entry) => (
            <div key={entry.group} className="flex items-center gap-2">
              <div
                className="h-4 w-4 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-sm">{entry.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function buildTicks(totalDepth: number): number[] {
  const ticks: number[] = []
  let d = 0
  while (d <= totalDepth) {
    ticks.push(d)
    d += 5
  }
  if (ticks[ticks.length - 1] === totalDepth) ticks.pop()
  return ticks
}
