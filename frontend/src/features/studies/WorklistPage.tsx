import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

interface Study {
  id: string;
  modality: string;
  studyDate: string;
  status: string;
  description?: string;
  patient: { firstName: string; lastName: string; internalCode: string };
  assignedDoctor?: { firstName: string; lastName: string } | null;
  reports: Array<{ id: string; status: string }>;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'UPLOADED', label: 'Cargado' },
  { value: 'IN_REVIEW', label: 'En revisión' },
  { value: 'REPORTED', label: 'Informado' }
];

const MODALITY_OPTIONS = ['', 'RX', 'TC', 'RM', 'ECO', 'PET', 'MAMM', 'NM'];

export function WorklistPage() {
  const [studies, setStudies] = useState<Study[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const LIMIT = 100;
  const [statusFilter, setStatusFilter] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async (p = page) => {
    setLoading(true);
    setError('');
    try {
      const params: any = { page: p, limit: LIMIT };
      if (statusFilter)   params.status   = statusFilter;
      if (modalityFilter) params.modality = modalityFilter;
      if (dateFrom) params.dateFrom = new Date(dateFrom + 'T00:00:00').toISOString();
      if (dateTo)   params.dateTo   = new Date(dateTo   + 'T23:59:59').toISOString();
      const { data } = await api.get('/studies/worklist', { params });
      setStudies(Array.isArray(data) ? data : data.data ?? []);
      setTotal(data.total ?? (Array.isArray(data) ? data.length : 0));
    } catch (err: any) {
      console.error('[WORKLIST]', err);
      setError(err?.response?.data?.message ?? 'Error al cargar la worklist');
    }
    setLoading(false);
  };

  useEffect(() => { setPage(1); load(1); }, [statusFilter, modalityFilter, dateFrom, dateTo]);
  useEffect(() => { if (page > 1) load(page); }, [page]);

  const clearFilters = () => {
    setStatusFilter('');
    setModalityFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = statusFilter || modalityFilter || dateFrom || dateTo;

  return (
    <AppLayout title="Worklist Operativa">
      {/* Filters */}
      <div className="card mb-4" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 160, flex: '1 1 160px' }}>
            <label>Estado</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 120, flex: '1 1 120px' }}>
            <label>Modalidad</label>
            <select value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)}>
              {MODALITY_OPTIONS.map((m) => <option key={m} value={m}>{m || 'Todas'}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 140, flex: '1 1 140px' }}>
            <label>Desde</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ minWidth: 140, flex: '1 1 140px' }}>
            <label>Hasta</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ marginBottom: 1 }}>
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <span>✕</span><span>{error}</span>
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted">
          {loading ? 'Cargando...' : `${total} estudio${total !== 1 ? 's' : ''} en worklist`}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => load(page)}>⟳ Actualizar</button>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prioridad</th>
              <th>Paciente</th>
              <th>Modalidad</th>
              <th>Fecha estudio</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Médico asignado</th>
              <th>Informe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div></td></tr>
            ) : studies.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    <div className="empty-icon">≡</div>
                    <div className="empty-title">Worklist vacía</div>
                    <div className="empty-desc">No hay estudios con los filtros seleccionados</div>
                  </div>
                </td>
              </tr>
            ) : (
              studies.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <span className="text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                  </td>
                  <td>
                    <span className="font-medium">{s.patient.lastName}, {s.patient.firstName}</span>
                    <div className="text-xs text-muted">{s.patient.internalCode}</div>
                  </td>
                  <td><span className="badge badge-blue">{s.modality}</span></td>
                  <td className="text-sm">{formatDate(s.studyDate)}</td>
                  <td className="text-sm text-muted truncate" style={{ maxWidth: 160 }}>{s.description || '—'}</td>
                  <td><StudyStatusBadge status={s.status} /></td>
                  <td className="text-sm">
                    {s.assignedDoctor
                      ? `Dr/a. ${s.assignedDoctor.lastName}`
                      : <span className="text-muted">Sin asignar</span>
                    }
                  </td>
                  <td>
                    {s.reports[0]
                      ? <ReportStatusBadge status={s.reports[0].status} />
                      : <span className="text-xs text-muted">Pendiente</span>
                    }
                  </td>
                  <td>
                    {s.reports[0]?.status === 'FINAL' || s.reports[0]?.status === 'SIGNED' ? (
                      <Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">
                        Ver informe
                      </Link>
                    ) : (
                      <Link to={`/studies/${s.id}`} className="btn btn-primary btn-sm">
                        Informar
                      </Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {Math.ceil(total / LIMIT) > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>← Anterior</button>
          <span className="text-sm text-muted">Página {page} de {Math.ceil(total / LIMIT)}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(Math.ceil(total / LIMIT), p + 1))} disabled={page >= Math.ceil(total / LIMIT)}>Siguiente →</button>
        </div>
      )}
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
