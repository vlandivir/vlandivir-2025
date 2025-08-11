import React, { useEffect, useState } from 'react';
import { useRawInitData } from '@telegram-apps/sdk-react';
import {
  Box,
  Heading,
  Flex,
  Avatar,
  Text,
  VStack,
  Image,
  Stack,
  HStack,
  Tag,
  Card,
  CardBody,
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
type TaskRecord = {
  id?: number;
  key: string;
  content: string;
  createdAt?: string | null;
  status?: string | null;
  completedAt?: string | null;
  priority?: string | null;
  dueDate: string | null;
  snoozedUntil?: string | null;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
};
type TaskDetails = {
  todo: TaskRecord;
  notes: { id: number; content: string }[];
  images: { id: number; url: string; description?: string | null }[];
  history?: TaskRecord[];
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
        if (
          data &&
          typeof data === 'object' &&
          'todo' in data &&
          data.todo &&
          typeof (data as any).todo === 'object'
        ) {
          const d = data as TaskDetails;
          const todo: TaskRecord = {
            key: d.todo.key,
            content: d.todo.content,
            dueDate: d.todo.dueDate ? String(d.todo.dueDate) : null,
            createdAt: d.todo.createdAt ? String(d.todo.createdAt) : null,
            status: d.todo.status ?? null,
            completedAt: d.todo.completedAt ? String(d.todo.completedAt) : null,
            priority: d.todo.priority ?? null,
            snoozedUntil: d.todo.snoozedUntil ? String(d.todo.snoozedUntil) : null,
            tags: Array.isArray(d.todo.tags) ? d.todo.tags : [],
            contexts: Array.isArray(d.todo.contexts) ? d.todo.contexts : [],
            projects: Array.isArray(d.todo.projects) ? d.todo.projects : [],
          };
          const history = Array.isArray(d.history)
            ? d.history.map((h) => ({
                id: h.id,
                key: h.key,
                content: h.content,
                createdAt: h.createdAt ? String(h.createdAt) : null,
                status: h.status ?? null,
                completedAt: h.completedAt ? String(h.completedAt) : null,
                priority: h.priority ?? null,
                dueDate: h.dueDate ? String(h.dueDate) : null,
                snoozedUntil: h.snoozedUntil ? String(h.snoozedUntil) : null,
                tags: Array.isArray(h.tags) ? h.tags : [],
                contexts: Array.isArray(h.contexts) ? h.contexts : [],
                projects: Array.isArray(h.projects) ? h.projects : [],
              }))
            : undefined;
          setSelected({ todo, notes: d.notes, images: d.images, history });
        }
      })
      .catch((e: unknown) => setError(String(e)));
  };

  function describeChanges(prev: TaskRecord, curr: TaskRecord): string {
    const changes: string[] = [];
    if (prev.content !== curr.content) changes.push(`content: ${curr.content}`);
    if (prev.priority !== curr.priority)
      changes.push(`priority: ${curr.priority ?? 'none'}`);
    if (prev.status !== curr.status) changes.push(`status: ${curr.status ?? 'none'}`);
    const prevDue = prev.dueDate ? new Date(prev.dueDate).getTime() : 0;
    const currDue = curr.dueDate ? new Date(curr.dueDate).getTime() : 0;
    if (prevDue !== currDue)
      changes.push(
        `due: ${curr.dueDate ? new Date(curr.dueDate).toLocaleString() : 'none'}`,
      );
    const prevS = prev.snoozedUntil ? new Date(prev.snoozedUntil).getTime() : 0;
    const currS = curr.snoozedUntil ? new Date(curr.snoozedUntil).getTime() : 0;
    if (prevS !== currS)
      changes.push(
        `snoozed until: ${curr.snoozedUntil ? new Date(curr.snoozedUntil).toLocaleString() : 'none'}`,
      );
    const arrEq = (a: string[] = [], b: string[] = []) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (!arrEq(prev.tags || [], curr.tags || []))
      changes.push(`tags: ${(curr.tags || []).join(', ')}`);
    if (!arrEq(prev.contexts || [], curr.contexts || []))
      changes.push(`contexts: ${(curr.contexts || []).join(', ')}`);
    if (!arrEq(prev.projects || [], curr.projects || []))
      changes.push(`projects: ${(curr.projects || []).join(', ')}`);
    return changes.join('; ');
  }

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
      {selected && (
        <Box mt={4}>
          <Card variant="outline">
            <CardBody>
              <Heading as="h2" size="sm">
                {selected.todo.key} {selected.todo.content}
              </Heading>
              <Stack spacing={1} mt={2}>
                {selected.todo.status && (
                  <Text>status: {selected.todo.status}</Text>
                )}
                {selected.todo.priority && (
                  <Text>priority: {selected.todo.priority}</Text>
                )}
                {selected.todo.dueDate && (
                  <Text>due: {new Date(selected.todo.dueDate).toLocaleString()}</Text>
                )}
                {selected.todo.snoozedUntil && (
                  <Text>
                    snoozed until: {new Date(selected.todo.snoozedUntil).toLocaleString()}
                  </Text>
                )}
                {(selected.todo.projects?.length || 0) > 0 && (
                  <HStack wrap="wrap">
                    {(selected.todo.projects || []).map((p) => (
                      <Tag key={`p-${p}`} colorScheme="purple">
                        {p}
                      </Tag>
                    ))}
                  </HStack>
                )}
                {(selected.todo.tags?.length || 0) > 0 && (
                  <HStack wrap="wrap">
                    {(selected.todo.tags || []).map((t) => (
                      <Tag key={`t-${t}`} colorScheme="blue">
                        {t}
                      </Tag>
                    ))}
                  </HStack>
                )}
                {(selected.todo.contexts?.length || 0) > 0 && (
                  <HStack wrap="wrap">
                    {(selected.todo.contexts || []).map((c) => (
                      <Tag key={`c-${c}`} colorScheme="green">
                        {c}
                      </Tag>
                    ))}
                  </HStack>
                )}
              </Stack>
            </CardBody>
          </Card>
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
          {selected.history && selected.history.length > 0 && (
            <Box mt={3}>
              <Heading as="h3" size="xs" mb={1}>
                Changes history
              </Heading>
              <VStack align="stretch" spacing={1}>
                {selected.history.map((h, i) => (
                  <Text key={h.id ?? i} fontSize="sm">
                    {h.createdAt ? new Date(h.createdAt).toLocaleString() : ''} -{' '}
                    {i === 0
                      ? `created: ${h.content}`
                      : (() => {
                          const prev = selected.history?.[i - 1];
                          return prev
                            ? describeChanges(prev, h) || 'no changes'
                            : '';
                        })()}
                  </Text>
                ))}
              </VStack>
            </Box>
          )}
        </Box>
      )}
      {tasks.length > 0 && (
        <VStack align="stretch" spacing={2} mt={4}>
          {tasks.map((t) => (
            <Card
              key={t.key}
              variant="outline"
              _hover={{ bg: 'rgba(0,0,0,0.04)', cursor: 'pointer' }}
              onClick={() => loadTask(t.key)}
            >
              <CardBody py={3}>
                <Text fontWeight="semibold">{t.key}</Text>
                <Text>{t.content}</Text>
                {t.dueDate && (
                  <Text fontSize="sm" opacity={0.8} mt={1}>
                    {new Date(t.dueDate).toLocaleString()}
                  </Text>
                )}
              </CardBody>
            </Card>
          ))}
        </VStack>
      )}
    </Box>
  );
}


