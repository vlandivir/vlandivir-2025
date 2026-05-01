import React, { useEffect, useState } from 'react';
import { useRawInitData } from '@telegram-apps/sdk-react';
import { Box, Heading, Flex, Avatar, Text, Stack } from '@chakra-ui/react';

type Counts = { notes: number; questions: number; answers: number };
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
                <b>Questions</b>: {user.counts.questions}
              </Text>
              <Text>
                <b>Answers</b>: {user.counts.answers}
              </Text>
            </Stack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
