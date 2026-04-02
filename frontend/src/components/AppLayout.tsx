import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../lib/auth';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: string[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '◈', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/worklist', label: 'Worklist', icon: '≡', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/studies', label: 'Estudios', icon: '⊞', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/patients', label: 'Pacientes', icon: '♥', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/reports', label: 'Informes', icon: '✎', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/portal', label: 'Mi Portal', icon: '⊕', roles: ['PATIENT'] }
];

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}

export function AppLayout({ children, title, actions }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => user && item.roles.includes(user.role));

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <motion.aside
        className="sidebar"
        initial={false}
        animate={{ width: collapsed ? 64 : 220 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
      >
        {/* Logo */}
        <div className="sidebar-logo">
          <span className="logo-icon">✚</span>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                className="logo-text"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
              >
                PACS<span style={{ color: '#38bdf8' }}>Med</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {visibleItems.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item ${active ? 'nav-item--active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      className="nav-label"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.12 }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="sidebar-footer">
          <AnimatePresence>
            {!collapsed && user && (
              <motion.div
                className="user-info"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="user-avatar">{user.firstName[0]}{user.lastName[0]}</div>
                <div className="user-meta">
                  <div className="user-name">{user.firstName} {user.lastName}</div>
                  <div className="user-role">{roleLabel(user.role)}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            className="logout-btn"
            onClick={handleLogout}
            title="Cerrar sesión"
          >
            <span>⎋</span>
            {!collapsed && <span className="nav-label">Salir</span>}
          </button>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="main-content">
        {(title || actions) && (
          <header className="page-header">
            <h1 className="page-title">{title}</h1>
            {actions && <div className="page-actions">{actions}</div>}
          </header>
        )}
        <main className="page-body">
          {children}
        </main>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'ADMIN': return 'Administrador';
    case 'DOCTOR': return 'Médico';
    case 'PATIENT': return 'Paciente';
    default: return role;
  }
}
