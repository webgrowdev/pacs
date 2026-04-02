import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications/my')
      .then((r) => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`).catch(() => {});
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: true } : i)));
  };

  const unreadCount = items.filter((i) => !i.isRead).length;

  return (
    <div className="card" style={{ maxHeight: 420, display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <span className="card-title">Notificaciones</span>
        {unreadCount > 0 && (
          <span className="badge badge-blue">{unreadCount} nueva{unreadCount > 1 ? 's' : ''}</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2].map((i) => <div key={i} className="skeleton" style={{ height: 60 }} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <div className="empty-desc">Sin notificaciones</div>
          </div>
        ) : (
          <div className="notif-list" style={{ padding: 12 }}>
            {items.map((n) => (
              <div key={n.id} className={`notif-item ${!n.isRead ? 'unread' : ''}`}>
                <div className="notif-title">{n.title}</div>
                <div className="notif-msg">{n.message}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <span className="notif-time">{formatDate(n.createdAt)}</span>
                  {!n.isRead && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => markRead(n.id)}
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >
                      Marcar leída
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
