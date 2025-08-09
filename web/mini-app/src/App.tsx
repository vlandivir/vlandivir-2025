import React, { useEffect, useState } from 'react';
import { useRawInitData } from '@telegram-apps/sdk-react';

type Counts = { notes: number; todos: number; questions: number; answers: number };
type UserData = {
  userId: number;
  userSummary: string | null;
  username: string | null;
  initials: string;
  hasAvatar: boolean;
  counts: Counts;
};

function getInitDataString(): string {
  return window.Telegram?.WebApp?.initData || '';
}

export default function App() {
  const rawInitData = useRawInitData();

  const [user, setUser] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initData = rawInitData ?? getInitDataString();
    const url = `/mini-app-api/user?initData=${encodeURIComponent(initData)}`;
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        if (
          data &&
          typeof data === 'object' &&
          'error' in data &&
          data.error
        ) {
          setError(String((data as { error: unknown }).error));
        } else {
          setUser(data as UserData);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [rawInitData]);

  const textColor = 'var(--tg-theme-text-color)';
  const bgColor = 'var(--tg-theme-bg-color)';
  const secondaryBg = 'var(--tg-theme-secondary-bg-color)';

  return (
    <div
      style={{
        color: textColor,
        background: bgColor,
        minHeight: '100vh',
        padding: 16,
        fontFamily: '-apple-system, Inter, Arial, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, marginBottom: 8, fontSize: 20 }}>Mini App</h1>
      <div style={{ borderRadius: 12, padding: 16, background: secondaryBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user?.hasAvatar ? (
            <img
              src={user?.userId ? `/mini-app-api/avatar?userId=${user.userId}` : undefined}
              alt={user?.userSummary || ''}
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.08)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
              }}
            >
              {user?.initials || '?'}
            </div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {user?.userSummary || 'Unknown user'}
            </div>
            <div style={{ opacity: 0.7 }}>
              {user?.username ? `@${user.username}` : ''}
            </div>
          </div>
        </div>
        <div style={{ height: 12 }} />
        <div>
          {error && <div>Error: {error}</div>}
          {!error && !user && <div>Loading...</div>}
          {user && (
            <div>
              <b>Notes</b>: {user.counts.notes}
              <br />
              <b>Todos</b>: {user.counts.todos}
              <br />
              <b>Questions</b>: {user.counts.questions}
              <br />
              <b>Answers</b>: {user.counts.answers}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


