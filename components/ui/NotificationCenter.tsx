'use client';

import { useEffect, useState } from 'react';

const MAX_NOTIFICATIONS = 5;

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<string[]>([]);

  useEffect(() => {
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'string' && detail) {
        setNotifications((prev) => [...prev, detail].slice(-MAX_NOTIFICATIONS));
      }
    };

    window.addEventListener('notification', handleNotification);

    // Fix: Add cleanup for the event listener to prevent memory bloat
    return () => {
      window.removeEventListener('notification', handleNotification);
    };
  }, []);

  return (
    <div className="fixed bottom-0 right-0 p-4">
      {notifications.map((note, idx) => (
        <div key={idx} className="bg-white p-2 shadow rounded mb-2">
          {note}
        </div>
      ))}
    </div>
  );
}
