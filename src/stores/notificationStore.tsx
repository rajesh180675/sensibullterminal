import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
}

interface NotificationStoreValue {
  items: NotificationItem[];
  notify: (input: Omit<NotificationItem, 'id' | 'createdAt'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const NotificationStore = createContext<NotificationStoreValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  const notify = useCallback((input: Omit<NotificationItem, 'id' | 'createdAt'>) => {
    const item: NotificationItem = {
      ...input,
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: Date.now(),
    };

    setItems((current) => [item, ...current].slice(0, 10));
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, notify, dismiss, clear }), [items, notify, dismiss, clear]);
  return <NotificationStore.Provider value={value}>{children}</NotificationStore.Provider>;
}

export function useNotificationStore() {
  const context = useContext(NotificationStore);
  if (!context) throw new Error('useNotificationStore must be used within NotificationProvider');
  return context;
}
