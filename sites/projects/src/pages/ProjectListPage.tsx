import { Building2, MapPin } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useProjects } from "@/features/projects/hooks"
import Navbar from "@/components/Navbar"

export default function ProjectListPage() {
  const { data: projects, isLoading, error } = useProjects()

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Navbar active="projects" />

      <main className="flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-semibold mb-6">프로젝트 목록</h1>

        {isLoading && (
          <div className="text-sm text-muted-foreground">로딩 중…</div>
        )}
        {error && (
          <div className="text-sm text-destructive">오류: {String(error)}</div>
        )}

        {projects && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <a key={p.id} href={`/detail/${p.id}`} className="block group">
                <Card className="h-full border-border/60 hover:border-border transition-colors group-hover:shadow-md">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium leading-snug line-clamp-2">
                      {p.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {p.region && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {p.region}
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      시추공 {p.borehole_count}개
                    </div>
                    {p.source_crs && (
                      <Badge variant="slate" className="w-fit text-xs">
                        {p.source_crs}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
