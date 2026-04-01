import { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';

export function PatientsPage() {
  const [patients, setPatients] = useState<any[]>([]);
  useEffect(() => { api.get('/patients').then((r) => setPatients(r.data)); }, []);
  return <Layout title="Pacientes"><table><thead><tr><th>Código</th><th>Nombre</th><th>Documento</th></tr></thead><tbody>{patients.map((p) => <tr key={p.id}><td>{p.internalCode}</td><td>{p.firstName} {p.lastName}</td><td>{p.documentId}</td></tr>)}</tbody></table></Layout>;
}
