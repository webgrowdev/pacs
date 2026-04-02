import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';

interface StudyResult {
  studyId: string;
  modality: string;
  studyDate: string;
  description?: string;
  status: string;
  report: {
    id: string;
    status: string;
    finalizedAt: string;
    conclusion: string;
    patientSummary?: string;
    doctorName: string;
    pdfUrl: string | null;
  } | null;
}

interface PatientProfile {
  firstName: string;
  lastName: string;
  internalCode: string;
  documentId: string;
  dateOfBirth: string;
  sex: string;
  email?: string;
  phone?: string;
}

export function PortalPage() {
  const { user, logout } = useAuth();
  const [results, setResults] = useState<StudyResult[]>([]);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedStudy, setExpandedStudy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/portal/my-results'),
      api.get('/portal/my-profile')
    ])
      .then(([resultsRes, profileRes]) => {
        setResults(resultsRes.data);
        setProfile(profileRes.data);
      })
      .catch((err) => {
        setError(err?.response?.data?.message ?? 'Error al cargar sus resultados');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(155deg, var(--gray-950) 0%, #0f2442 50%, var(--gray-950) 100%)',
      padding: '0'
    }}>
      {/* Portal Header */}
      <header style={{
        background: '#0d1b35',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 32px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, color: '#38bdf8' }}>✚</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
            PACS<span style={{ color: '#38bdf8' }}>Med</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 8, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 99 }}>
            Portal del Paciente
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user && (
            <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>
              {user.firstName} {user.lastName}
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={logout}
            style={{ color: 'var(--gray-500)' }}
          >
            ⎋ Salir
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 28 }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            Bienvenido/a, {profile?.firstName}
          </h1>
          <p style={{ color: 'var(--gray-500)', fontSize: 14 }}>
            Aquí puede consultar sus estudios médicos e informes disponibles.
          </p>
        </motion.div>

        {/* Profile card */}
        {profile && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card"
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <span className="card-title">Sus datos</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 24px', fontSize: 13 }}>
              {[
                { label: 'Nombre completo', value: `${profile.firstName} ${profile.lastName}` },
                { label: 'Código de paciente', value: profile.internalCode },
                { label: 'Documento', value: profile.documentId },
                { label: 'Fecha de nacimiento', value: formatDate(profile.dateOfBirth) },
                { label: 'Sexo', value: profile.sex === 'M' ? 'Masculino' : profile.sex === 'F' ? 'Femenino' : 'N/E' },
                ...(profile.email ? [{ label: 'Email', value: profile.email }] : []),
                ...(profile.phone ? [{ label: 'Teléfono', value: profile.phone }] : [])
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>{label}</div>
                  <div style={{ color: 'var(--gray-200)', fontWeight: 500 }}>{value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }}>
            <span>✕</span><span>{error}</span>
          </div>
        )}

        {/* Studies */}
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--gray-300)' }}>
            Mis estudios ({results.length})
          </h2>
        </div>

        {results.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⊞</div>
            <div className="empty-title">Sin estudios disponibles</div>
            <div className="empty-desc">Cuando se cargue un estudio a su nombre aparecerá aquí</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {results.map((s, i) => (
              <motion.div
                key={s.studyId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05 }}
                className="portal-card"
              >
                <div
                  className="portal-card-header"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedStudy(expandedStudy === s.studyId ? null : s.studyId)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="badge badge-blue">{s.modality}</span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-200)' }}>
                      {s.description || `Estudio ${s.modality}`}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>{formatDate(s.studyDate)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {s.report ? (
                      <span className="badge badge-green">✓ Informe disponible</span>
                    ) : (
                      <span className="badge badge-yellow">Informe pendiente</span>
                    )}
                    <span style={{ color: 'var(--gray-500)', fontSize: 14 }}>
                      {expandedStudy === s.studyId ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {expandedStudy === s.studyId && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="portal-card-body"
                  >
                    {s.report ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                          <div>
                            <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>Médico informante</div>
                            <div style={{ fontWeight: 500 }}>Dr/a. {s.report.doctorName}</div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>Fecha del informe</div>
                            <div style={{ fontWeight: 500 }}>{formatDate(s.report.finalizedAt)}</div>
                          </div>
                        </div>

                        {s.report.patientSummary && (
                          <div style={{
                            background: 'rgba(22,163,74,0.08)',
                            border: '1px solid rgba(22,163,74,0.2)',
                            borderRadius: 10,
                            padding: '14px 16px'
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#86efac', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                              Resumen de su informe
                            </div>
                            <p style={{ fontSize: 14, color: 'var(--gray-300)', lineHeight: 1.65 }}>
                              {s.report.patientSummary}
                            </p>
                          </div>
                        )}

                        <div style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--gray-700)',
                          borderRadius: 10,
                          padding: '14px 16px'
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                            Conclusión médica
                          </div>
                          <p style={{ fontSize: 14, color: 'var(--gray-400)', lineHeight: 1.65, fontStyle: 'italic' }}>
                            {s.report.conclusion}
                          </p>
                        </div>

                        <div className="alert alert-info" style={{ fontSize: 12 }}>
                          <span>ℹ</span>
                          <span>
                            Este resumen es orientativo. Consulte con su médico tratante para la interpretación
                            completa y las indicaciones correspondientes.
                          </span>
                        </div>

                        {s.report.pdfUrl && (
                          <a
                            href={s.report.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ alignSelf: 'flex-start' }}
                          >
                            📄 Descargar informe completo (PDF)
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="empty-state" style={{ padding: '24px 0' }}>
                        <div className="empty-desc">
                          Su informe está siendo elaborado por el médico. Lo notificaremos cuando esté disponible.
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--gray-600)', textAlign: 'center', marginTop: 40 }}>
          Sus datos son confidenciales y están protegidos. Solo usted puede acceder a esta información.
        </p>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
