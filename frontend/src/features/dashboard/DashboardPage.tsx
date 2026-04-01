import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { NotificationsPanel } from './NotificationsPanel';

export function DashboardPage() {
  const role = localStorage.getItem('userRole');
  return (
    <Layout title={role === 'ADMIN' ? 'Dashboard Administrador' : 'Dashboard Médico'}>
      <div className="cards">
        <Link to="/patients" className="card">Pacientes</Link>
        <Link to="/studies" className="card">Estudios</Link>
        <Link to="/reports" className="card">Informes</Link>
        <Link to="/worklist" className="card">Worklist</Link>
      </div>
      <NotificationsPanel />
    </Layout>
  );
}
