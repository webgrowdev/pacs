import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';

export function StudiesPage() {
  const [studies, setStudies] = useState<any[]>([]);
  useEffect(() => { api.get('/studies').then((r) => setStudies(r.data)); }, []);
  return <Layout title="Estudios"><ul>{studies.map((s) => <li key={s.id}><Link to={`/studies/${s.id}`}>{s.modality} - {s.patient.firstName} {s.patient.lastName}</Link></li>)}</ul></Layout>;
}
