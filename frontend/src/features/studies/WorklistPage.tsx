import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';

export function WorklistPage() {
  const [studies, setStudies] = useState<any[]>([]);

  useEffect(() => {
    api.get('/studies/worklist').then((r) => setStudies(r.data));
  }, []);

  return (
    <Layout title="Worklist Operativa">
      <ul>
        {studies.map((s) => (
          <li key={s.id}>
            <Link to={`/studies/${s.id}`}>
              [{s.status}] {s.modality} - {s.patient.lastName}, {s.patient.firstName}
            </Link>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
