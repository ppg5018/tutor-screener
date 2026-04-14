import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import WelcomePage   from './pages/WelcomePage.jsx'
import InterviewPage from './pages/InterviewPage.jsx'
import ReportPage    from './pages/ReportPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import LoginPage     from './pages/LoginPage.jsx'

function ProtectedRoute({ children }) {
  const { token } = useAuth()
  const location  = useLocation()
  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return children
}

function AppRoutes() {
  return (
    <>
      <div className="grain-overlay" aria-hidden="true" />
      <Routes>
        <Route path="/"                  element={<WelcomePage />} />
        <Route path="/login"             element={<LoginPage />} />
        <Route path="/interview/:token"  element={<InterviewPage />} />
        <Route path="/report"            element={<ReportPage />} />
        <Route path="/dashboard"         element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
