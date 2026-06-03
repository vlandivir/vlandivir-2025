import React, { useEffect, useState } from 'react';
import { useRawInitData } from '@telegram-apps/sdk-react';
import { Avatar, Box, Flex, Heading, Stack, Text } from '@chakra-ui/react';

type Counts = { notes: number };
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
        if (data && typeof data === 'object' && 'error' in data && data.error) {
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

  const textColor = 'var(--tg-theme-text-color, hsl(222.2 84% 4.9%))';
  const bgColor = 'var(--tg-theme-bg-color, hsl(0 0% 100%))';
  const secondaryBg = 'var(--tg-theme-secondary-bg-color, hsl(210 40% 96.1%))';

  return (
    <Box
      color={textColor}
      bg={bgColor}
      minH="100vh"
      px={4}
      py={6}
      fontFamily="body"
    >
      <Heading as="h1" size="md" mb={4} lineHeight="1.1">
        Mini App
      </Heading>
      <Box
        border="1px solid"
        borderColor="shadcn.border"
        borderRadius="lg"
        bg={secondaryBg}
        p={4}
        shadow="sm"
      >
        <Flex align="center" gap={3}>
          <Avatar
            size="xl"
            name={user?.userSummary || 'Unknown user'}
            src={
              user?.hasAvatar && user.userId
                ? `/mini-app-api/avatar?userId=${user.userId}`
                : undefined
            }
          />
          <Box>
            <Text fontSize="lg" fontWeight="semibold">
              {user?.userSummary || 'Unknown user'}
            </Text>
            <Text color="shadcn.mutedForeground">
              {user?.username ? `@${user.username}` : ''}
            </Text>
          </Box>
        </Flex>
        <Box h={4} />
        <Box>
          {error && <Text color="shadcn.destructive">Error: {error}</Text>}
          {!error && !user && (
            <Text color="shadcn.mutedForeground">Loading...</Text>
          )}
          {user && (
            <Stack spacing={1}>
              <Text>
                <b>Notes</b>: {user.counts.notes}
              </Text>
            </Stack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
