import { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';

export function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  useEffect(() => { api.get('/reports').then((r) => setReports(r.data)); }, []);
  return <Layout title="Informes"><ul>{reports.map((r) => <li key={r.id}>{r.study.patient.lastName} - {r.status} {r.pdfPath ? <a href={`http://localhost:4000/files/pdfs/${r.id}.pdf`}>PDF</a> : ''}</li>)}</ul></Layout>;
}
