import React, { useEffect, useState } from 'react';
import { useRawInitData } from '@telegram-apps/sdk-react';
import {
  Box,
  Heading,
  Flex,
  Avatar,
  Text,
  VStack,
  Button,
  Image,
  Stack,
} from '@chakra-ui/react';

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
    <Box
      color={textColor}
      bg={bgColor}
      minH="100vh"
      p={4}
      fontFamily="-apple-system, Inter, Arial, sans-serif"
    >
      <Heading as="h1" size="md" mb={2}>
        Mini App
      </Heading>
      <Box borderRadius="lg" p={4} bg={secondaryBg}>
        <Flex align="center" gap={3}>
          <Avatar
            size="xl"
            name={user?.userSummary || 'Unknown user'}
            src={user?.hasAvatar && user.userId ? `/mini-app-api/avatar?userId=${user.userId}` : undefined}
          />
          <Box>
            <Text fontSize="lg" fontWeight="semibold">
              {user?.userSummary || 'Unknown user'}
            </Text>
            <Text opacity={0.7}>{user?.username ? `@${user.username}` : ''}</Text>
          </Box>
        </Flex>
        <Box h={3} />
        <Box>
          {error && <Text color="red.500">Error: {error}</Text>}
          {!error && !user && <Text>Loading...</Text>}
          {user && (
            <Stack spacing={1}>
              <Text>
                <b>Notes</b>: {user.counts.notes}
              </Text>
              <Text>
                <b>Todos</b>: {user.counts.todos}
              </Text>
              <Text>
                <b>Questions</b>: {user.counts.questions}
              </Text>
              <Text>
                <b>Answers</b>: {user.counts.answers}
              </Text>
            </Stack>
          )}
        </Box>
      </Box>
      {tasks.length > 0 && (
        <VStack align="stretch" spacing={2} mt={4}>
          {tasks.map((t) => (
            <Button key={t.key} onClick={() => loadTask(t.key)} justifyContent="flex-start" variant="outline">
              {`${t.key}: ${t.content}`}
            </Button>
          ))}
        </VStack>
      )}
      {selected && (
        <Box mt={4}>
          <Heading as="h2" size="sm">
            {selected.todo.key} {selected.todo.content}
          </Heading>
          {selected.todo.dueDate && (
            <Text mt={1}>Due: {new Date(selected.todo.dueDate).toLocaleString()}</Text>
          )}
          {selected.images.length > 0 && (
            <VStack align="stretch" spacing={2} mt={2}>
              {selected.images.map((img) => (
                <Box key={img.id}>
                  <Image src={img.url} alt={img.description || ''} maxW="100%" />
                  {img.description && <Text mt={1}>{img.description}</Text>}
                </Box>
              ))}
            </VStack>
          )}
          {selected.notes.length > 0 && (
            <VStack align="stretch" spacing={2} mt={2}>
              {selected.notes.map((n) => (
                <Box
                  key={n.id}
                  bg="rgba(0,0,0,0.05)"
                  p={2}
                  sx={{ whiteSpace: 'pre-wrap' }}
                >
                  {n.content}
                </Box>
              ))}
            </VStack>
          )}
        </Box>
      )}
    </Box>
  );
}


