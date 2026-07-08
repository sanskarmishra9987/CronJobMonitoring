import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isAuthenticated } from './api/client'
import Dashboard from './pages/Dashboard'
import MonitorForm from './pages/MonitorForm'
import MonitorDetail from './pages/MonitorDetail'
import Login from './components/Login'
import Settings from './pages/Settings'
import AlertToastStack from './components/AlertToastStack'

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      {isAuthenticated() && <AlertToastStack />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/monitors/new" element={<RequireAuth><MonitorForm /></RequireAuth>} />
        <Route path="/monitors/:id/edit" element={<RequireAuth><MonitorForm /></RequireAuth>} />
        <Route path="/monitors/:id" element={<RequireAuth><MonitorDetail /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}