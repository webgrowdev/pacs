import { ReactNode } from 'react';
import { useModules } from '../lib/modules';

interface ModuleGuardProps {
  module: string;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renderiza children solo si el módulo está activo.
 * Uso: <ModuleGuard module="AGENDA"><AgendaPage /></ModuleGuard>
 * Si el módulo no está activo, renderiza fallback o null.
 */
export function ModuleGuard({ module, children, fallback = null }: ModuleGuardProps) {
  const { hasModule, isLoading } = useModules();

  if (isLoading) return null;

  if (!hasModule(module)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div style={{
        padding: 32,
        textAlign: 'center',
        color: 'var(--gray-500)',
        fontSize: 14
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Módulo no disponible</div>
        <div style={{ fontSize: 12 }}>El módulo <strong>{module}</strong> no está activo en este sistema.</div>
      </div>
    );
  }

  return <>{children}</>;
}
