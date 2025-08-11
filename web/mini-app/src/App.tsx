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

type TaskSummary = { key: string; content: string; dueDate: string | null };
type TaskDetails = {
  todo: { key: string; content: string; dueDate: string | null };
  notes: { id: number; content: string }[];
  images: { id: number; url: string; description?: string | null }[];
};

function getInitDataString(): string {
  return window.Telegram?.WebApp?.initData || '';
}

export default function App() {
  const rawInitData = useRawInitData();

  const [user, setUser] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selected, setSelected] = useState<TaskDetails | null>(null);

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

  useEffect(() => {
    if (!user) return;
    const initData = rawInitData ?? getInitDataString();
    const url = `/mini-app-api/todos?initData=${encodeURIComponent(initData)}`;
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setTasks(
            data.map((t) => ({
              key: t.key,
              content: t.content,
              dueDate: t.dueDate ? String(t.dueDate) : null,
            })),
          );
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [user, rawInitData]);

  const loadTask = (key: string) => {
    const initData = rawInitData ?? getInitDataString();
    const url = `/mini-app-api/todo?initData=${encodeURIComponent(
      initData,
    )}&key=${encodeURIComponent(key)}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'todo' in data) {
          const d = data as TaskDetails;
          setSelected({
            todo: {
              key: d.todo.key,
              content: d.todo.content,
              dueDate: d.todo.dueDate ? String(d.todo.dueDate) : null,
            },
            notes: d.notes,
            images: d.images,
          });
        }
      })
      .catch((e: unknown) => setError(String(e)));
  };

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
      {tasks.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {tasks.map((t) => (
            <div key={t.key} style={{ marginBottom: 8 }}>
              <button onClick={() => loadTask(t.key)}>{`${t.key}: ${t.content}`}</button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div style={{ marginTop: 16 }}>
          <h2>
            {selected.todo.key} {selected.todo.content}
          </h2>
          {selected.todo.dueDate && (
            <div>Due: {new Date(selected.todo.dueDate).toLocaleString()}</div>
          )}
          {selected.images.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {selected.images.map((img) => (
                <div key={img.id} style={{ marginBottom: 8 }}>
                  <img src={img.url} style={{ maxWidth: '100%' }} />
                  {img.description && <div>{img.description}</div>}
                </div>
              ))}
            </div>
          )}
          {selected.notes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {selected.notes.map((n) => (
                <pre
                  key={n.id}
                  style={{
                    background: 'rgba(0,0,0,0.05)',
                    padding: 8,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {n.content}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


