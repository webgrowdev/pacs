import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);

      // If server requires password change (first login or temp password), redirect immediately
      if (result.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }

      // Redirigir según rol
      const stored = sessionStorage.getItem('pacsUser');
      const role = stored ? JSON.parse(stored).role : null;
      navigate(role === 'PATIENT' ? '/portal' : '/dashboard', { replace: true });
    } catch (err: any) {
      const data = err?.response?.data;
      const msg = data?.message
        || (Array.isArray(data?.errors) ? data.errors.map((e: any) => e.msg || e.message).join('. ') : null)
        || 'Error al ingresar. Verifique sus credenciales.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="login-logo">
          <span className="login-logo-icon">✚</span>
          <span className="login-logo-text">
            PACS<span style={{ color: '#38bdf8' }}>Med</span>
          </span>
        </div>

        <p className="login-subtitle">Plataforma de diagnóstico por imágenes</p>

        <form onSubmit={submit} className="form-grid">
          <div className="form-group">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@dominio.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              minLength={8}
            />
          </div>

          {error && (
            <div className="alert alert-error">
              <span>✕</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                Ingresando...
              </>
            ) : (
              'Ingresar al sistema'
            )}
          </button>
        </form>

        <p className="text-sm text-muted mt-4" style={{ textAlign: 'center' }}>
          Acceso restringido a personal autorizado.
        </p>
      </motion.div>
    </div>
  );
}
