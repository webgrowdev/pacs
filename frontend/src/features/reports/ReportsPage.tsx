import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

interface Report {
  id: string;
  status: string;
  finalizedAt?: string;
  draftedAt?: string;
  pdfPath?: string;
  findings: string;
  conclusion: string;
  study: {
    id: string;
    modality: string;
    studyDate: string;
    description?: string;
    patient: { firstName: string; lastName: string; internalCode: string };
  };
  doctor: { firstName: string; lastName: string };
  measurements: Array<{ label: string; value: number; unit: string }>;
}

export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Report | null>(null);

  useEffect(() => {
    api.get('/reports')
      .then((r) => setReports(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter ? reports.filter((r) => r.status === statusFilter) : reports;

  return (
    <AppLayout title="Informes médicos">
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: 180 }}
        >
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borrador</option>
          <option value="FINAL">Finalizado</option>
          <option value="SIGNED">Firmado</option>
        </select>
        <span className="text-sm text-muted">
          {loading ? 'Cargando...' : `${filtered.length} informe${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 20 }}>
        {/* Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Modalidad</th>
                <th>Fecha estudio</th>
                <th>Médico</th>
                <th>Estado</th>
                <th>Fecha cierre</th>
                <th>PDF</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-icon">✎</div>
                      <div className="empty-title">Sin informes</div>
                      <div className="empty-desc">Los informes aparecerán aquí al ser redactados</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(selected?.id === r.id ? null : r)}
                  >
                    <td>
                      <span className="font-medium">
                        {r.study.patient.lastName}, {r.study.patient.firstName}
                      </span>
                      <div className="text-xs text-muted">{r.study.patient.internalCode}</div>
                    </td>
                    <td><span className="badge badge-blue">{r.study.modality}</span></td>
                    <td className="text-sm">{formatDate(r.study.studyDate)}</td>
                    <td className="text-sm">Dr/a. {r.doctor.lastName}</td>
                    <td><ReportStatusBadge status={r.status} /></td>
                    <td className="text-sm text-muted">{r.finalizedAt ? formatDate(r.finalizedAt) : '—'}</td>
                    <td>
                      {r.pdfPath ? (
                        <a
                          href={`/files/${r.pdfPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          📄 PDF
                        </a>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        to={`/studies/${r.study.id}`}
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="card" style={{ position: 'sticky', top: 80, alignSelf: 'start', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
            <div className="card-header" style={{ marginBottom: 16 }}>
              <span className="card-title">Detalle del informe</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>PACIENTE</div>
                <div className="font-medium">{selected.study.patient.lastName}, {selected.study.patient.firstName}</div>
                <div className="text-muted">{selected.study.patient.internalCode}</div>
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>ESTUDIO</div>
                <div>{selected.study.modality} — {formatDate(selected.study.studyDate)}</div>
                {selected.study.description && <div className="text-muted">{selected.study.description}</div>}
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>MÉDICO</div>
                <div>Dr/a. {selected.doctor.firstName} {selected.doctor.lastName}</div>
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>HALLAZGOS</div>
                <div style={{ lineHeight: 1.6, color: 'var(--gray-300)' }}>{selected.findings}</div>
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 4 }}>CONCLUSIÓN</div>
                <div style={{ lineHeight: 1.6, color: 'var(--gray-300)' }}>{selected.conclusion}</div>
              </div>

              {selected.measurements.length > 0 && (
                <div>
                  <div className="text-xs text-muted" style={{ marginBottom: 4 }}>MEDICIONES</div>
                  {selected.measurements.map((m, i) => (
                    <div key={i}>• {m.label}: <strong>{m.value} {m.unit}</strong></div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 8 }}>
                <Link to={`/studies/${selected.study.id}`} className="btn btn-primary btn-sm">
                  Abrir estudio y visor
                </Link>
                {selected.pdfPath && (
                  <a href={`/files/${selected.pdfPath}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                    📄 Descargar PDF
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ReportStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    DRAFT:  { label: 'Borrador', cls: 'badge-yellow' },
    FINAL:  { label: 'Finalizado', cls: 'badge-green' },
    SIGNED: { label: 'Firmado', cls: 'badge-purple' }
  };
  const m = map[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}
