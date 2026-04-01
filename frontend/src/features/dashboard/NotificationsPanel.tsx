import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function NotificationsPanel() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    api.get('/notifications/my').then((r) => setItems(r.data));
  }, []);

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: true } : i)));
  };

  return (
    <div>
      <h3>Notificaciones</h3>
      <ul>
        {items.map((n) => (
          <li key={n.id}>
            <strong>{n.title}</strong> - {n.message} {!n.isRead && <button onClick={() => markRead(n.id)}>Marcar leída</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
