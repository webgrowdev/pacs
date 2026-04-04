import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts';
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

interface Analytics {
  studiesByStatus: { status: string; count: number }[];
  studiesByModality: { modality: string; count: number }[];
  studiesByDate: { date: string; count: number }[];
  topDoctors: { doctorId: string; name: string; reports: number }[];
  totals: { studies: number; patients: number; finalReports: number };
}

const STATUS_LABELS: Record<string, string> = {
  UPLOADED: 'Cargado', IN_REVIEW: 'En revisión', REPORTED: 'Informado', PUBLISHED: 'Publicado'
};
const STATUS_COLORS: Record<string, string> = {
  UPLOADED: '#3b82f6', IN_REVIEW: '#f59e0b', REPORTED: '#22c55e', PUBLISHED: '#8b5cf6'
};
const MODALITY_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({});
  const [recentStudies, setRecentStudies] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState('');

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
      } catch (err: any) {
        setError(err?.response?.data?.message ?? 'Error al cargar el dashboard');
      }
      setLoading(false);
    }

    async function loadAnalytics() {
      try {
        const { data } = await api.get('/analytics');
        setAnalytics(data);
      } catch {
        // analytics is optional, don't show error
      }
      setAnalyticsLoading(false);
    }

    load();
    loadAnalytics();
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <AppLayout title={`${greeting()}, ${user?.firstName}`}>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <span>✕</span><span>{error}</span>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid">
        {[
          { label: 'Pacientes registrados', value: analytics?.totals.patients ?? stats.patients ?? '—', color: '#3b82f6' },
          { label: 'Total de estudios', value: analytics?.totals.studies ?? stats.studies ?? '—', color: '#8b5cf6' },
          { label: 'Pendientes de informe', value: stats.pending ?? '—', color: '#f59e0b' },
          { label: 'Informes finales', value: analytics?.totals.finalReports ?? stats.reported ?? '—', color: '#22c55e' }
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className="stat-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            style={{ '--accent': s.color } as any}
          >
            <div className="stat-value" style={{ color: s.color }}>{loading ? '—' : s.value}</div>
            <div className="stat-label">{s.label}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 24 }}>
        <div>
          {/* Accesos rápidos */}
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
                    background: 'var(--gray-50)',
                    border: '1px solid var(--gray-200)',
                    borderRadius: 10,
                    textDecoration: 'none',
                    transition: 'background 0.15s, border-color 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--brand-50)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--brand-300)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--gray-50)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--gray-200)';
                  }}
                >
                  <span style={{ fontSize: 22 }}>{item.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-800)' }}>{item.label}</span>
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
              <div className="empty-state"><div className="empty-desc">No hay estudios cargados</div></div>
            ) : (
              <table>
                <thead>
                  <tr><th>Paciente</th><th>Modalidad</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {recentStudies.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.patient?.lastName}, {s.patient?.firstName}</td>
                      <td><span className="badge badge-blue">{s.modality}</span></td>
                      <td><StudyStatusBadge status={s.status} /></td>
                      <td><Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">Ver</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Analytics Charts */}
          {!analyticsLoading && analytics && (
            <>
              {/* Studies by Status */}
              <div className="card mt-4">
                <div className="card-header">
                  <span className="card-title">Estudios por estado</span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={analytics.studiesByStatus.map((s) => ({ name: STATUS_LABELS[s.status] ?? s.status, value: s.count, fill: STATUS_COLORS[s.status] ?? '#94a3b8' }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
                    <Bar dataKey="value" radius={[4,4,0,0]}>
                      {analytics.studiesByStatus.map((s, i) => (
                        <Cell key={i} fill={STATUS_COLORS[s.status] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                {/* By Modality */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Por modalidad</span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={analytics.studiesByModality} dataKey="count" nameKey="modality" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => percent != null ? `${name} ${(percent * 100).toFixed(0)}%` : String(name ?? '')} labelLine={false} style={{ fontSize: 11 }}>
                        {analytics.studiesByModality.map((_, i) => (
                          <Cell key={i} fill={MODALITY_COLORS[i % MODALITY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Top Doctors */}
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Top médicos</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                    {analytics.topDoctors.length === 0 ? (
                      <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '20px 0' }}>Sin datos</div>
                    ) : analytics.topDoctors.map((d, i) => (
                      <div key={d.doctorId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18, width: 24, textAlign: 'center', color: i === 0 ? '#f59e0b' : 'var(--gray-400)' }}>
                          {i === 0 ? '★' : `${i+1}.`}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{d.reports} informe{d.reports !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Studies over time */}
              {analytics.studiesByDate.length > 0 && (
                <div className="card mt-4">
                  <div className="card-header">
                    <span className="card-title">Estudios últimos 30 días</span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={analytics.studiesByDate}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} labelFormatter={(l) => `Fecha: ${l}`} />
                      <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Estudios" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
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
