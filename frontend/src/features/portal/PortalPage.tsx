import { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';

export function PortalPage() {
  const [results, setResults] = useState<any[]>([]);
  useEffect(() => { api.get('/portal/my-results').then((r) => setResults(r.data)); }, []);
  return <Layout title="Portal del Paciente"><ul>{results.map((r) => <li key={r.studyId}>Estudio {r.modality} - Estado {r.status} {r.pdfPath && <a href={`http://localhost:4000/files/pdfs/${r.pdfPath.split('/').pop()}`}>Descargar informe</a>}</li>)}</ul></Layout>;
}
