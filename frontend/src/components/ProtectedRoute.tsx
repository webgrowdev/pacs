import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, UserRole } from '../lib/auth';

interface Props {
  children: ReactNode;
  roles?: UserRole[];
}

export function ProtectedRoute({ children, roles }: Props) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  if (roles && !roles.includes(user.role)) {
    // Redirigir al destino correcto según el rol
    if (user.role === 'PATIENT') return <Navigate to="/portal" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
