import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PatientsPage } from '../features/patients/PatientsPage';
import { PatientDetailPage } from '../features/patients/PatientDetailPage';
import { StudiesPage } from '../features/studies/StudiesPage';
import { StudyDetailPage } from '../features/studies/StudyDetailPage';
import { WorklistPage } from '../features/studies/WorklistPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { PortalPage } from '../features/portal/PortalPage';
import { AdminPage } from '../features/admin/AdminPage';

export function AppRouter() {
  const { user, mustChangePassword } = useAuth();

  return (
    <Routes>
      {/* Password change — intercepts all navigation when mustChangePassword is true */}
      <Route
        path="/change-password"
        element={
          user
            ? <ChangePasswordPage />
            : <Navigate to="/" replace />
        }
      />

      {/* If authenticated but must change password, force redirect */}
      {user && mustChangePassword && (
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      )}

      {/* Login: si ya está autenticado, redirigir */}
      <Route
        path="/"
        element={
          user
            ? <Navigate to={user.role === 'PATIENT' ? '/portal' : '/dashboard'} replace />
            : <LoginPage />
        }
      />

      {/* Rutas de admin y médico */}
      <Route path="/dashboard" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><DashboardPage /></ProtectedRoute>} />
      <Route path="/patients" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><PatientsPage /></ProtectedRoute>} />
      <Route path="/patients/:id" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><PatientDetailPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute roles={['ADMIN']}><AdminPage /></ProtectedRoute>} />
      <Route path="/studies" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><StudiesPage /></ProtectedRoute>} />
      <Route path="/studies/:id" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><StudyDetailPage /></ProtectedRoute>} />
      <Route path="/worklist" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><WorklistPage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute roles={['ADMIN', 'DOCTOR']}><ReportsPage /></ProtectedRoute>} />

      {/* Ruta exclusiva de paciente */}
      <Route path="/portal" element={<ProtectedRoute roles={['PATIENT']}><PortalPage /></ProtectedRoute>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
