import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MOCK_PROJECTS, type Project } from "@/mock/data"

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  return (
    <div className="h-full overflow-auto p-8">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">프로젝트 목록</h1>
        <Button onClick={() => setNewProjectOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          새 프로젝트
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {MOCK_PROJECTS.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onClick={() => navigate(`/projects/${project.id}`)}
          />
        ))}
      </div>

      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>새 프로젝트</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            프로젝트 생성 기능은 준비 중입니다.
          </p>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  )
}

function ProjectCard({
  project,
  onClick,
}: {
  project: Project
  onClick: () => void
}) {
  return (
    <Card
      className="cursor-pointer border-border/60 transition-all duration-150 hover:border-sky-400/60 hover:ring-1 hover:ring-sky-400/40"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{project.name}</CardTitle>
          <Badge variant="slate" className="shrink-0">
            시추공 {project.borehole_count}개
          </Badge>
        </div>
        <CardDescription>{project.region}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          업데이트: {project.updated_at}
        </p>
      </CardContent>
    </Card>
  )
}
