import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { PortalAccessPanel } from './PortalAccessPanel';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Patient {
  id: string;
  internalCode: string;
  firstName: string;
  lastName: string;
  documentId: string;
  dateOfBirth: string;
  sex: string;
  email?: string;
  phone?: string;
  studies: { id: string; modality: string; studyDate: string; status: string }[];
  patientAccess?: { userId: string; lastLoginAt: string | null } | null;
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get(`/patients/${id}`)
      .then(({ data }) => setPatient(data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Error al cargar paciente'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (error) return <AppLayout title="Error"><div className="alert alert-error"><span>✕</span><span>{error}</span></div></AppLayout>;
  if (!patient) return null;

  return (
    <AppLayout
      title={`${patient.lastName}, ${patient.firstName}`}
      actions={<Link to="/patients" className="btn btn-secondary btn-sm">← Volver</Link>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>

        {/* Datos del paciente */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Datos personales</span>
            <span className="badge badge-gray">{patient.internalCode}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 24px', fontSize: 13 }}>
            {[
              { label: 'Nombre completo', value: `${patient.firstName} ${patient.lastName}` },
              { label: 'Documento', value: patient.documentId },
              { label: 'Fecha de nacimiento', value: new Date(patient.dateOfBirth).toLocaleDateString('es-AR') },
              { label: 'Sexo', value: patient.sex === 'M' ? 'Masculino' : patient.sex === 'F' ? 'Femenino' : 'N/E' },
              ...(patient.email ? [{ label: 'Email', value: patient.email }] : []),
              ...(patient.phone ? [{ label: 'Teléfono', value: patient.phone }] : [])
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ color: 'var(--gray-500)', marginBottom: 2 }}>{label}</div>
                <div style={{ color: 'var(--gray-800)', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Acceso al portal — solo admin */}
        {isAdmin && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Portal del Paciente</span>
            </div>
            <PortalAccessPanel
              patientId={patient.id}
              patientFirstName={patient.firstName}
              patientEmail={patient.email}
            />
          </div>
        )}

        {/* Estudios */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Estudios ({patient.studies?.length ?? 0})</span>
            <Link to={`/studies?patientId=${patient.id}`} className="btn btn-ghost btn-sm">Ver todos</Link>
          </div>
          {(!patient.studies || patient.studies.length === 0) ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div className="empty-desc">No hay estudios registrados para este paciente</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>Fecha</th><th>Modalidad</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {patient.studies.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.studyDate).toLocaleDateString('es-AR')}</td>
                    <td><span className="badge badge-blue">{s.modality}</span></td>
                    <td><span className={`status-${s.status}`} style={{ fontSize: 13, fontWeight: 500 }}>{s.status}</span></td>
                    <td><Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">Ver</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
