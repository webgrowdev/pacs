import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 12,         label: 'Al menos 12 caracteres' },
  { test: (p: string) => /[A-Z]/.test(p),        label: 'Una letra mayúscula' },
  { test: (p: string) => /[a-z]/.test(p),        label: 'Una letra minúscula' },
  { test: (p: string) => /[0-9]/.test(p),        label: 'Un número' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: 'Un carácter especial (!@#$%...)' }
];

export function ChangePasswordPage() {
  const navigate  = useNavigate();
  const { logout } = useAuth();

  const [current,  setCurrent]  = useState('');
  const [newPwd,   setNewPwd]   = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);

  const allRulesMet  = PASSWORD_RULES.every((r) => r.test(newPwd));
  const passwordsMatch = newPwd === confirm && confirm.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!allRulesMet) {
      setError('La nueva contraseña no cumple todos los requisitos de seguridad.');
      return;
    }
    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (current === newPwd) {
      setError('La nueva contraseña debe ser diferente a la actual.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword:     newPwd
      });
      setSuccess(true);
      // Brief pause before redirecting so the user sees the success message
      setTimeout(async () => {
        await logout();
        navigate('/', { replace: true });
      }, 2500);
    } catch (err: any) {
      const serverErrors: string[] = err?.response?.data?.errors;
      setError(
        serverErrors?.join('. ')
          ?? err?.response?.data?.message
          ?? 'Error al cambiar la contraseña. Intente nuevamente.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <motion.div
        className="login-card"
        style={{ maxWidth: 460 }}
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

        {success ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h2 style={{ color: 'var(--gray-800)', marginBottom: 8 }}>Contraseña actualizada</h2>
            <p style={{ color: 'var(--gray-500)', fontSize: 14 }}>
              Su contraseña fue cambiada exitosamente. Será redirigido al inicio de sesión.
            </p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--gray-800)', marginBottom: 4 }}>
              Cambio de contraseña requerido
            </h2>
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
              Por seguridad, debe establecer una nueva contraseña antes de continuar.
            </p>

            <form onSubmit={handleSubmit} className="form-grid">
              <div className="form-group">
                <label htmlFor="current">Contraseña temporal actual</label>
                <input
                  id="current"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className="form-group">
                <label htmlFor="newPwd">Nueva contraseña</label>
                <input
                  id="newPwd"
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="new-password"
                />
                {/* Password strength indicator */}
                {newPwd.length > 0 && (
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }}>
                    {PASSWORD_RULES.map((rule) => (
                      <li
                        key={rule.label}
                        style={{
                          color:      rule.test(newPwd) ? '#16a34a' : 'var(--gray-400)',
                          display:    'flex',
                          gap:        6,
                          alignItems: 'center',
                          marginBottom: 2
                        }}
                      >
                        <span>{rule.test(newPwd) ? '✓' : '○'}</span>
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirm">Confirmar nueva contraseña</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="new-password"
                  style={{
                    borderColor: confirm.length > 0
                      ? (passwordsMatch ? '#16a34a' : '#ef4444')
                      : undefined
                  }}
                />
                {confirm.length > 0 && !passwordsMatch && (
                  <p style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Las contraseñas no coinciden</p>
                )}
              </div>

              {error && (
                <div className="alert alert-error">
                  <span>✕</span><span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg w-full"
                disabled={loading || !allRulesMet || !passwordsMatch}
              >
                {loading ? (
                  <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Cambiando...</>
                ) : (
                  'Establecer nueva contraseña'
                )}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
