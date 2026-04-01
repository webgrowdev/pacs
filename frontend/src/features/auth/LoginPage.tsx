import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Layout } from '../../components/Layout';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('doctor@pacs.local');
  const [password, setPassword] = useState('ChangeMe123!');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('userRole', data.user.role);
    if (data.user.role === 'PATIENT') navigate('/portal');
    else navigate('/dashboard');
  };

  return <Layout title="Ingreso seguro"><form onSubmit={submit} className="grid"><input value={email} onChange={(e) => setEmail(e.target.value)} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><button>Ingresar</button></form></Layout>;
}
