import { BrowserRouter, Route, Routes } from "react-router-dom"

import AppLayout from "@/components/layout/AppLayout"
import LoginPage from "@/pages/LoginPage"
import MapPage from "@/pages/MapPage"
import ProjectDetailPage from "@/pages/ProjectDetailPage"
import ProjectsPage from "@/pages/ProjectsPage"
import UploadPage from "@/pages/UploadPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route
          path="/projects"
          element={
            <AppLayout>
              <ProjectsPage />
            </AppLayout>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <AppLayout>
              <ProjectDetailPage />
            </AppLayout>
          }
        />
        <Route
          path="/map"
          element={
            <AppLayout>
              <MapPage />
            </AppLayout>
          }
        />
        <Route
          path="/upload"
          element={
            <AppLayout>
              <UploadPage />
            </AppLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
