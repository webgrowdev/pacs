import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { NotificationsPanel } from './NotificationsPanel';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Stats {
  patients?: number;
  studies?: number;
  pending?: number;
  reported?: number;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({});
  const [recentStudies, setRecentStudies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [studiesRes, patientsRes] = await Promise.all([
          api.get('/studies'),
          api.get('/patients')
        ]);
        const studies: any[] = studiesRes.data;
        const patients: any[] = patientsRes.data;
        setStats({
          patients: patients.length,
          studies: studies.length,
          pending: studies.filter((s) => s.status === 'UPLOADED' || s.status === 'IN_REVIEW').length,
          reported: studies.filter((s) => s.status === 'REPORTED').length
        });
        setRecentStudies(studies.slice(0, 5));
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <AppLayout
      title={`${greeting()}, ${user?.firstName}`}
    >
      {/* Stats */}
      <div className="stats-grid">
        {[
          { label: 'Pacientes registrados', value: stats.patients ?? '—', color: '#38bdf8' },
          { label: 'Total de estudios', value: stats.studies ?? '—', color: '#818cf8' },
          { label: 'Pendientes de informe', value: stats.pending ?? '—', color: '#fbbf24' },
          { label: 'Informes generados', value: stats.reported ?? '—', color: '#34d399' }
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className="stat-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            style={{ '--accent': s.color } as any}
          >
            <div className="stat-value">{loading ? '—' : s.value}</div>
            <div className="stat-label">{s.label}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 24 }}>
        {/* Accesos rápidos */}
        <div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Accesos rápidos</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {[
                { to: '/worklist', label: 'Worklist', icon: '≡', desc: 'Estudios pendientes' },
                { to: '/studies', label: 'Estudios', icon: '⊞', desc: 'Todos los estudios' },
                { to: '/patients', label: 'Pacientes', icon: '♥', desc: 'Gestión de pacientes' },
                { to: '/reports', label: 'Informes', icon: '✎', desc: 'Informes generados' }
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '14px 16px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--gray-700)',
                    borderRadius: 10,
                    textDecoration: 'none',
                    transition: 'background 0.15s, border-color 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(37,99,235,0.12)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--brand-700)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--gray-700)';
                  }}
                >
                  <span style={{ fontSize: 22 }}>{item.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-200)' }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{item.desc}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Estudios recientes */}
          <div className="card mt-4">
            <div className="card-header">
              <span className="card-title">Estudios recientes</span>
              <Link to="/studies" className="btn btn-ghost btn-sm">Ver todos</Link>
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
              </div>
            ) : recentStudies.length === 0 ? (
              <div className="empty-state">
                <div className="empty-desc">No hay estudios cargados</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Modalidad</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentStudies.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.patient?.lastName}, {s.patient?.firstName}</td>
                      <td><span className="badge badge-blue">{s.modality}</span></td>
                      <td><StudyStatusBadge status={s.status} /></td>
                      <td>
                        <Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">Ver</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Notificaciones */}
        <NotificationsPanel />
      </div>
    </AppLayout>
  );
}

function StudyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    UPLOADED:  { label: 'Cargado', cls: 'badge-gray' },
    IN_REVIEW: { label: 'En revisión', cls: 'badge-yellow' },
    REPORTED:  { label: 'Informado', cls: 'badge-green' },
    PUBLISHED: { label: 'Publicado', cls: 'badge-purple' }
  };
  const m = map[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
