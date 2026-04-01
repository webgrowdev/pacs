import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PatientsPage } from '../features/patients/PatientsPage';
import { StudiesPage } from '../features/studies/StudiesPage';
import { StudyDetailPage } from '../features/studies/StudyDetailPage';
import { WorklistPage } from '../features/studies/WorklistPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { PortalPage } from '../features/portal/PortalPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/patients" element={<PatientsPage />} />
      <Route path="/studies" element={<StudiesPage />} />
      <Route path="/studies/:id" element={<StudyDetailPage />} />
      <Route path="/worklist" element={<WorklistPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/portal" element={<PortalPage />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
