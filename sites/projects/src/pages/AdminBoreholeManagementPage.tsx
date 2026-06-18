import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Database, RefreshCw, Search, Trash2 } from "lucide-react"
import Navbar from "@/components/Navbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { Borehole } from "@/lib/types"

interface CurrentUser {
  id: number
  email: string
  role: string
  full_name?: string | null
}

interface BoreholeResponse {
  boreholes: Borehole[]
  count: number
  total: number
  limit: number
  offset: number
}

const ORIGIN_LABEL: Record<string, string> = {
  public: "공공데이터",
  user_upload: "사용자 업로드",
  manual_input: "직접 입력",
  test: "테스트",
}

const PAGE_SIZE = 50

function originLabel(origin?: string | null) {
  return ORIGIN_LABEL[origin || "public"] ?? origin ?? "공공데이터"
}

function fileName(path?: string | null) {
  if (!path) return "-"
  return path.split(/[\\/]/).pop() || path
}

function maxDepth(borehole: Borehole) {
  if (!borehole.strata?.length) return null
  return Math.max(...borehole.strata.map((s) => s.depth_bottom ?? 0))
}

function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const res = await api.get<CurrentUser>("/auth/me")
      return res.data
    },
  })
}

function useAdminBoreholes() {
  return useQuery({
    queryKey: ["admin-boreholes"],
    queryFn: async () => {
      const res = await api.get<BoreholeResponse>("/boreholes?limit=50000&include_strata=true")
      return res.data
    },
  })
}

function OriginBadge({ origin }: { origin?: string | null }) {
  const label = originLabel(origin)
  const className =
    origin === "user_upload"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : origin === "manual_input"
        ? "bg-sky-100 text-sky-800 border-sky-200"
        : origin === "test"
          ? "bg-rose-100 text-rose-800 border-rose-200"
          : "bg-stone-100 text-stone-700 border-stone-200"

  return <Badge variant="outline" className={className}>{label}</Badge>
}

export default function AdminBoreholeManagementPage() {
  const queryClient = useQueryClient()
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data, isLoading, error, refetch, isFetching } = useAdminBoreholes()
  const [query, setQuery] = useState("")
  const [origin, setOrigin] = useState("all")
  const [page, setPage] = useState(1)

  const deleteMutation = useMutation({
    mutationFn: async (borehole: Borehole) => {
      await api.delete(`/boreholes/${borehole.id}`)
      return borehole
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-boreholes"] })
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["boreholes"] })
    },
  })

  const boreholes = data?.boreholes ?? []
  const stats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of boreholes) {
      const key = b.data_origin || "public"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [boreholes])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return boreholes.filter((b) => {
      if (origin !== "all" && (b.data_origin || "public") !== origin) return false
      if (!needle) return true
      return [
        String(b.id),
        String(b.project_id),
        b.name,
        b.source_file || "",
        b.source_crs || "",
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [boreholes, origin, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleDelete = async (borehole: Borehole) => {
    const ok = confirm(
      `시추공 '${borehole.name}'(ID ${borehole.id})을 삭제하시겠습니까?\n\n` +
      "삭제된 시추공은 프로젝트 목록과 지도/3D 조회에서 제외됩니다.",
    )
    if (!ok) return
    try {
      await deleteMutation.mutateAsync(borehole)
    } catch (err: any) {
      alert(`삭제하지 못했습니다.\n\n${err.response?.data?.detail || err.message}`)
    }
  }

  const isAdmin = user?.role === "admin"

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Navbar active="admin" />

      <main className="flex-1 overflow-hidden flex flex-col">
        <section className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-xl font-semibold">시추공 관리</h1>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                공공데이터, 사용자 업로드, 직접 입력 데이터를 구분하여 전체 시추공을 관리합니다.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              새로고침
            </Button>
          </div>

          {!userLoading && !isAdmin && (
            <div className="mt-3 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              현재 계정은 관리자 권한이 아닙니다. 목록 조회는 가능하지만 삭제는 서버에서 거부됩니다.
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-4 border-b border-border bg-background">
          <StatCard label="전체" value={boreholes.length} />
          <StatCard label="공공데이터" value={stats.get("public") ?? 0} />
          <StatCard label="사용자 업로드" value={stats.get("user_upload") ?? 0} />
          <StatCard label="직접 입력" value={stats.get("manual_input") ?? 0} />
          <StatCard label="테스트" value={stats.get("test") ?? 0} />
        </section>

        <section className="flex items-center gap-3 px-6 py-3 border-b border-border bg-card">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="ID, 시추공명, 프로젝트 ID, 원본 파일명 검색"
              className="h-9 w-full rounded border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <select
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value)
              setPage(1)
            }}
            className="h-9 rounded border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">전체 출처</option>
            <option value="public">공공데이터</option>
            <option value="user_upload">사용자 업로드</option>
            <option value="manual_input">직접 입력</option>
            <option value="test">테스트</option>
          </select>
          <div className="text-xs text-muted-foreground">
            {filtered.length.toLocaleString()}개 표시
          </div>
        </section>

        <section className="flex-1 overflow-auto px-6 py-4">
          {isLoading && <div className="text-sm text-muted-foreground">시추공 목록을 불러오는 중입니다.</div>}
          {error && <div className="text-sm text-destructive">목록을 불러오지 못했습니다: {String(error)}</div>}

          {!isLoading && !error && (
            <div className="overflow-hidden rounded border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">ID</th>
                    <th className="px-3 py-2 text-left font-medium">시추공명</th>
                    <th className="px-3 py-2 text-left font-medium">출처</th>
                    <th className="px-3 py-2 text-left font-medium">프로젝트</th>
                    <th className="px-3 py-2 text-right font-medium">표고</th>
                    <th className="px-3 py-2 text-right font-medium">굴착심도</th>
                    <th className="px-3 py-2 text-left font-medium">위치</th>
                    <th className="px-3 py-2 text-left font-medium">원본</th>
                    <th className="px-3 py-2 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => {
                    const depth = maxDepth(b)
                    return (
                      <tr key={b.id} className="border-t border-border/70 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{b.id}</td>
                        <td className="px-3 py-2 font-medium">{b.name}</td>
                        <td className="px-3 py-2"><OriginBadge origin={b.data_origin} /></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{b.project_id}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {b.elevation == null ? "-" : `${b.elevation.toFixed(2)}m`}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">
                          {depth == null ? "-" : `${depth.toFixed(2)}m`}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {b.longitude.toFixed(5)}, {b.latitude.toFixed(5)}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground" title={b.source_file || ""}>
                          {fileName(b.source_file)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending || !isAdmin}
                            onClick={() => handleDelete(b)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            삭제
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        조건에 맞는 시추공이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="flex items-center justify-between border-t border-border bg-card px-6 py-3 text-xs text-muted-foreground">
          <span>
            {safePage} / {totalPages} 페이지
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              이전
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              다음
            </Button>
          </div>
        </footer>
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  )
}
