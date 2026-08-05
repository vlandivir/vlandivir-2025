import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  IconButton,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Stack,
  Text,
  Textarea,
  useColorMode,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { applyAppTheme, subscribeToThemeChanges } from './theme';

type Provider = 'GOOGLE' | 'TELEGRAM';
type Project = {
  id: string;
  name: string;
  archivedAt: string | null;
  archived: boolean;
};
type Attachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
};
type Task = {
  id: string;
  content: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  projectId: string | null;
  project: Project | null;
  dueDate: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
};
type Bootstrap = {
  identity: {
    provider: Provider;
    displayName: string | null;
    linked: boolean;
    providers: Provider[];
  };
  projects: Project[];
  currentTask: Task | null;
  counts: { available: number; active: number };
  nextWakeAt: string | null;
};
type TaskEvent = {
  id: string;
  type: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
type TaskDetails = Task & {
  events: TaskEvent[];
  stats: { snoozed: number; rotated: number };
};

const initData = window.Telegram?.WebApp?.initData || '';

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (initData) headers.set('x-telegram-init-data', initData);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`/gtd-api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(data?.message || `Ошибка ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchAttachmentBlob(attachment: Attachment) {
  const headers = new Headers();
  if (initData) headers.set('x-telegram-init-data', initData);
  const response = await fetch(`/gtd-api/attachments/${attachment.id}`, {
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Не удалось загрузить файл');
  return response.blob();
}

async function downloadAttachment(attachment: Attachment) {
  const blob = await fetchAttachmentBlob(attachment);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.originalName;
  anchor.target = '_blank';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function isImageAttachment(attachment: Attachment) {
  return attachment.mimeType.startsWith('image/');
}

function isVideoAttachment(attachment: Attachment) {
  return attachment.mimeType.startsWith('video/');
}

function formatDate(value: string) {
  return (
    new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  );
}

function dueDateInputValue(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function isDueOverdue(value: string, now = new Date()) {
  const endOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return new Date(value).getTime() < endOfToday - 86_400_000;
}

function isDueToday(value: string, now = new Date()) {
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = start + 86_400_000;
  const time = new Date(value).getTime();
  return time >= start && time < end;
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const ATTACH_ACCEPT =
  'image/*,video/*,.pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

/** Auth'd blob URL — Telegram Mini App can't put initData on <img src>. */
function useAttachmentObjectUrl(attachment: Attachment) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void fetchAttachmentBlob(attachment)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  return { url, failed };
}

function AttachmentPreview({
  attachment,
  compact = false,
}: {
  attachment: Attachment;
  compact?: boolean;
}) {
  const toast = useToast();
  const media = isImageAttachment(attachment) || isVideoAttachment(attachment);
  const { url, failed } = useAttachmentObjectUrl(attachment);

  if (!media) {
    return (
      <Button
        variant="outline"
        justifyContent="space-between"
        fontWeight="normal"
        width="100%"
        onClick={() =>
          void downloadAttachment(attachment).catch((reason: unknown) =>
            toast({ status: 'error', title: String(reason) }),
          )
        }
      >
        <Text noOfLines={1}>{attachment.originalName}</Text>
        <Text color="shadcn.mutedForeground" fontSize="xs">
          {fileSize(attachment.size)}
        </Text>
      </Button>
    );
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="shadcn.border"
      borderRadius="md"
      overflow="hidden"
      bg="shadcn.muted"
    >
      {failed && (
        <Button
          variant="ghost"
          width="100%"
          borderRadius={0}
          onClick={() =>
            void downloadAttachment(attachment).catch((reason: unknown) =>
              toast({ status: 'error', title: String(reason) }),
            )
          }
        >
          Не удалось показать · скачать
        </Button>
      )}
      {!failed && !url && (
        <Flex align="center" justify="center" minH={compact ? '96px' : '160px'}>
          <Spinner size="sm" />
        </Flex>
      )}
      {url && isImageAttachment(attachment) && (
        <Box
          as="a"
          href={url}
          target="_blank"
          rel="noreferrer"
          display="block"
          cursor="zoom-in"
        >
          <Box
            as="img"
            src={url}
            alt={attachment.originalName}
            maxH={compact ? '160px' : '360px'}
            w="100%"
            objectFit="contain"
            display="block"
            bg="blackAlpha.50"
          />
        </Box>
      )}
      {url && isVideoAttachment(attachment) && (
        <Box
          as="video"
          src={url}
          controls
          playsInline
          preload="metadata"
          maxH={compact ? '200px' : '420px'}
          w="100%"
          display="block"
          bg="black"
        />
      )}
      <Flex
        px={3}
        py={2}
        justify="space-between"
        gap={2}
        align="center"
        borderTopWidth="1px"
        borderColor="shadcn.border"
        bg="shadcn.card"
      >
        <Text fontSize="xs" noOfLines={1} title={attachment.originalName}>
          {attachment.originalName}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          flexShrink={0}
          onClick={() =>
            void downloadAttachment(attachment).catch((reason: unknown) =>
              toast({ status: 'error', title: String(reason) }),
            )
          }
        >
          Скачать
        </Button>
      </Flex>
    </Box>
  );
}

function AttachmentsList({
  attachments,
  compact = false,
}: {
  attachments: Attachment[];
  compact?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <Stack spacing={3}>
      {attachments.map((attachment) => (
        <AttachmentPreview
          key={attachment.id}
          attachment={attachment}
          compact={compact}
        />
      ))}
    </Stack>
  );
}

export default function App() {
  const isLinkPage = location.pathname === '/gtd/link';
  return (
    <ThemeSync>{isLinkPage ? <LinkConfirmation /> : <GtdApp />}</ThemeSync>
  );
}

function ThemeSync({ children }: { children: React.ReactNode }) {
  const { setColorMode } = useColorMode();
  useEffect(() => {
    setColorMode(applyAppTheme());
    return subscribeToThemeChanges(setColorMode);
  }, [setColorMode]);
  return <>{children}</>;
}

function LinkConfirmation() {
  const token = new URLSearchParams(location.search).get('token') || '';
  const [preview, setPreview] = useState<{
    google: string;
    telegram: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ google: string; telegram: string; expiresAt: string }>(
      `/link/preview?token=${encodeURIComponent(token)}`,
    )
      .then(setPreview)
      .catch((reason: unknown) =>
        setError(String(reason instanceof Error ? reason.message : reason)),
      );
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/link/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <Box maxW="560px" mx="auto" mt={{ base: 8, md: 20 }}>
        <Heading size="lg" mb={2}>
          Привязка GTD
        </Heading>
        <Text color="shadcn.mutedForeground" mb={6}>
          Подтвердите объединение Google и Telegram.
        </Text>
        <Panel>
          {error && (
            <Alert status="error" mb={4}>
              <AlertIcon />
              {error}
            </Alert>
          )}
          {!preview && !error && (
            <Flex justify="center" py={8}>
              <Spinner />
            </Flex>
          )}
          {preview && !done && (
            <Stack spacing={4}>
              <IdentityRow label="Google" value={preview.google} />
              <IdentityRow label="Telegram" value={preview.telegram} />
              <Text fontSize="sm" color="shadcn.mutedForeground">
                Проекты, задачи, вложения и история с обеих сторон будут
                сохранены.
              </Text>
              <Button variant="primary" onClick={confirm} isLoading={busy}>
                Объединить пространства
              </Button>
            </Stack>
          )}
          {done && (
            <Stack spacing={3}>
              <Heading size="md">Готово</Heading>
              <Text>
                Аккаунты связаны. Вернитесь в Telegram Mini App — данные
                обновятся автоматически.
              </Text>
            </Stack>
          )}
        </Panel>
      </Box>
    </PageShell>
  );
}

function GtdApp() {
  const toast = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('all');
  const create = useDisclosure();
  const projects = useDisclosure();
  const archive = useDisclosure();
  const history = useDisclosure();
  const settings = useDisclosure();
  const edit = useDisclosure();

  const scopeQuery = useMemo(() => {
    if (scope === 'inbox') return '?scope=inbox';
    if (scope === 'today') return '?scope=today';
    if (scope.startsWith('project:'))
      return `?scope=project&projectId=${encodeURIComponent(scope.slice(8))}`;
    return '?scope=all';
  }, [scope]);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setBusy(true);
      try {
        const next = await api<Bootstrap>(`/bootstrap${scopeQuery}`);
        setData(next);
        setError('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [scopeQuery],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);
  useEffect(() => {
    if (!data?.nextWakeAt) return;
    const delay = Math.max(
      250,
      new Date(data.nextWakeAt).getTime() - Date.now() + 250,
    );
    const timer = window.setTimeout(
      () => void refresh(true),
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [data?.nextWakeAt, refresh]);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const action = async (value: string) => {
    if (!data?.currentTask) return;
    setBusy(true);
    try {
      await api(`/tasks/${data.currentTask.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: value }),
      });
      await refresh(true);
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <Box mb={5}>
        <Heading size="lg">GTD</Heading>
        <Text fontSize="sm" color="shadcn.mutedForeground">
          {data?.identity.displayName || 'Загрузка…'}
        </Text>
      </Box>

      {error && (
        <Alert status="error" mb={4}>
          <AlertIcon />
          {error}
        </Alert>
      )}

      {busy && !data ? (
        <Flex justify="center" py={24}>
          <Spinner />
        </Flex>
      ) : (
        <TaskCard
          task={data?.currentTask || null}
          busy={busy}
          onAction={action}
          onEdit={edit.onOpen}
          onHistory={history.onOpen}
          onRefresh={() => refresh(true)}
        />
      )}

      <Flex gap={2} mt={4} wrap={{ base: 'wrap', md: 'nowrap' }}>
        <Select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          flex={{ base: '1 1 100%', md: '1 1 auto' }}
        >
          <option value="all">Все задачи</option>
          <option value="today">Сегодня</option>
          <option value="inbox">Входящие</option>
          {data?.projects
            .filter((project) => !project.archived)
            .map((project) => (
              <option value={`project:${project.id}`} key={project.id}>
                {project.name}
              </option>
            ))}
        </Select>
        <Button flex={{ base: '1', md: '0 0 auto' }} onClick={projects.onOpen}>
          Проекты
        </Button>
        <Button variant="primary" onClick={create.onOpen} minW="48px">
          ＋
        </Button>
      </Flex>
      <Flex gap={2} mt={2} justify="flex-end">
        <Button size="sm" variant="outline" onClick={archive.onOpen}>
          Архив
        </Button>
        <IconButton
          aria-label="Настройки"
          size="sm"
          variant="outline"
          icon={<Text fontSize="lg">⋯</Text>}
          onClick={settings.onOpen}
        />
      </Flex>

      <CreateTaskModal
        disclosure={create}
        projects={data?.projects || []}
        onCreated={() => refresh(true)}
      />
      <EditTaskModal
        disclosure={edit}
        task={data?.currentTask || null}
        projects={data?.projects || []}
        onSaved={() => refresh(true)}
      />
      <ProjectsModal
        disclosure={projects}
        projects={data?.projects || []}
        onChanged={() => {
          if (scope === 'all') void refresh(true);
          else setScope('all');
        }}
      />
      <ArchiveModal disclosure={archive} />
      <HistoryModal disclosure={history} task={data?.currentTask || null} />
      <SettingsModal
        disclosure={settings}
        identity={data?.identity || null}
        onLinked={() => refresh(true)}
      />
    </PageShell>
  );
}

function TaskCard(props: {
  task: Task | null;
  busy: boolean;
  onAction: (action: string) => void;
  onEdit: () => void;
  onHistory: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const task = props.task;

  const upload = async (files: FileList | null) => {
    if (!files || !task) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        await api(`/tasks/${task.id}/attachments`, {
          method: 'POST',
          body: form,
        });
      }
      await props.onRefresh();
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (!task) {
    return (
      <Panel>
        <Stack
          align="center"
          textAlign="center"
          py={{ base: 12, md: 20 }}
          spacing={3}
        >
          <Text fontSize="3xl">✓</Text>
          <Heading size="md">Сейчас ничего нет</Heading>
          <Text color="shadcn.mutedForeground">
            Все доступные задачи обработаны или отложены.
          </Text>
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel>
      <Box mb={6}>
        <Flex align="center" gap={2} mb={3} wrap="wrap">
          <Badge>{task.project?.name || 'Входящие'}</Badge>
          {task.dueDate && (
            <Text
              fontSize="xs"
              color={
                isDueOverdue(task.dueDate)
                  ? 'shadcn.destructive'
                  : 'shadcn.mutedForeground'
              }
              opacity={isDueOverdue(task.dueDate) ? 0.85 : 0.75}
            >
              {isDueOverdue(task.dueDate)
                ? `просрочено · ${formatDueDate(task.dueDate)}`
                : isDueToday(task.dueDate)
                  ? `сегодня · ${formatDueDate(task.dueDate)}`
                  : `до ${formatDueDate(task.dueDate)}`}
            </Text>
          )}
        </Flex>
        <Text
          fontSize={{ base: '2xl', md: '3xl' }}
          fontWeight="semibold"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
          lineHeight="short"
        >
          {task.content}
        </Text>
      </Box>

      {task.attachments.length > 0 && (
        <Box mb={5}>
          <AttachmentsList attachments={task.attachments} />
        </Box>
      )}

      <Flex wrap="wrap" gap={2} mb={5}>
        <Button size="sm" variant="ghost" onClick={props.onEdit}>
          Редактировать
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onHistory}>
          История
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileInput.current?.click()}
          isLoading={uploading}
        >
          Прикрепить
        </Button>
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          onChange={(event) => void upload(event.target.files)}
        />
      </Flex>

      <Divider mb={5} />
      <Stack spacing={3}>
        <ButtonGroup isAttached width="100%">
          <Button
            flex="1"
            variant="success"
            onClick={() => props.onAction('COMPLETE')}
            isDisabled={props.busy}
          >
            Выполнено
          </Button>
          <Button
            flex="1"
            variant="outline"
            onClick={() => props.onAction('ROTATE')}
            isDisabled={props.busy}
          >
            Не сейчас
          </Button>
        </ButtonGroup>
        <ButtonGroup width="100%">
          <Menu>
            <MenuButton
              as={Button}
              flex="1"
              variant="outline"
              isDisabled={props.busy}
            >
              Отложить ▾
            </MenuButton>
            <MenuList>
              <MenuItem onClick={() => props.onAction('SNOOZE_HOUR')}>
                На час
              </MenuItem>
              <MenuItem onClick={() => props.onAction('SNOOZE_TOMORROW')}>
                До завтра, 09:00 UTC
              </MenuItem>
              <MenuItem onClick={() => props.onAction('SNOOZE_MONDAY')}>
                До понедельника, 09:00 UTC
              </MenuItem>
              <MenuItem onClick={() => props.onAction('SNOOZE_WEEK')}>
                На неделю
              </MenuItem>
            </MenuList>
          </Menu>
          <Button
            flex="1"
            variant="ghost"
            color="shadcn.destructive"
            onClick={() => props.onAction('CANCEL')}
            isDisabled={props.busy}
          >
            Отменить
          </Button>
        </ButtonGroup>
      </Stack>
    </Panel>
  );
}

function CreateTaskModal({
  disclosure,
  projects,
  onCreated,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  projects: Project[];
  onCreated: () => void;
}) {
  const [content, setContent] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const task = await api<Task>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          content,
          projectId: projectId || null,
          dueDate: dueDate || null,
        }),
      });
      for (const file of files.slice(0, 10)) {
        const form = new FormData();
        form.append('file', file);
        await api(`/tasks/${task.id}/attachments`, {
          method: 'POST',
          body: form,
        });
      }
      setContent('');
      setProjectId('');
      setDueDate('');
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      disclosure.onClose();
      onCreated();
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Новая задача</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <FormControl>
              <FormLabel>Что нужно сделать?</FormLabel>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                autoFocus
              />
            </FormControl>
            <FormControl>
              <FormLabel>Проект</FormLabel>
              <Select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Входящие</option>
                {projects
                  .filter((project) => !project.archived)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Дедлайн</FormLabel>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Вложения</FormLabel>
              <Stack spacing={2}>
                <Flex gap={2} align="center" wrap="wrap">
                  <Button
                    variant="outline"
                    onClick={() => fileInput.current?.click()}
                  >
                    Выбрать файлы
                  </Button>
                  {files.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFiles([]);
                        if (fileInput.current) fileInput.current.value = '';
                      }}
                    >
                      Очистить
                    </Button>
                  )}
                </Flex>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  multiple
                  accept={ATTACH_ACCEPT}
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files || []).slice(0, 10))
                  }
                />
                <Text fontSize="sm" color="shadcn.mutedForeground">
                  {files.length === 0
                    ? 'Файлы не выбраны'
                    : files.length === 1
                      ? files[0]?.name || '1 файл'
                      : `Выбрано файлов: ${files.length}`}
                </Text>
              </Stack>
            </FormControl>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={2} onClick={disclosure.onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={busy}
            isDisabled={!content.trim()}
          >
            Создать
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function EditTaskModal({
  disclosure,
  task,
  projects,
  onSaved,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  task: Task | null;
  projects: Project[];
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (disclosure.isOpen && task) {
      setContent(task.content);
      setProjectId(task.projectId || '');
      setDueDate(dueDateInputValue(task.dueDate));
    }
  }, [disclosure.isOpen, task]);
  const save = async () => {
    if (!task) return;
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content,
          projectId: projectId || null,
          dueDate: dueDate || null,
        }),
      });
      disclosure.onClose();
      onSaved();
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Редактировать задачу</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <Select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Входящие</option>
              {projects
                .filter(
                  (project) =>
                    !project.archived || project.id === task?.projectId,
                )
                .map((project) => (
                  <option
                    key={project.id}
                    value={project.id}
                    disabled={project.archived}
                  >
                    {project.name}
                    {project.archived ? ' — архив' : ''}
                  </option>
                ))}
            </Select>
            <FormControl>
              <FormLabel>Дедлайн</FormLabel>
              <Flex gap={2}>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
                {dueDate && (
                  <Button
                    variant="ghost"
                    onClick={() => setDueDate('')}
                    flexShrink={0}
                  >
                    Сбросить
                  </Button>
                )}
              </Flex>
            </FormControl>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={save} variant="primary">
            Сохранить
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ProjectsModal({
  disclosure,
  projects,
  onChanged,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  projects: Project[];
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const toast = useToast();
  const create = async () => {
    try {
      await api('/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setName('');
      onChanged();
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };
  const update = async (project: Project, patch: Record<string, unknown>) => {
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onChanged();
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Проекты</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={3}>
            <Flex gap={2}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Новый проект"
              />
              <Button onClick={create} isDisabled={!name.trim()}>
                Создать
              </Button>
            </Flex>
            <Divider />
            {projects.map((project) => (
              <Flex key={project.id} align="center" gap={2}>
                <Text
                  flex="1"
                  color={
                    project.archived ? 'shadcn.mutedForeground' : undefined
                  }
                >
                  {project.name}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const next = prompt('Название проекта', project.name);
                    if (next) void update(project, { name: next });
                  }}
                >
                  Переименовать
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void update(project, { archived: !project.archived })
                  }
                >
                  {project.archived ? 'Вернуть' : 'В архив'}
                </Button>
              </Flex>
            ))}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={disclosure.onClose}>Готово</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ArchiveModal({
  disclosure,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!disclosure.isOpen) return;
    setLoading(true);
    api<{ tasks: Task[] }>(
      `/archive${status === 'all' ? '' : `?status=${status}`}`,
    )
      .then((result) => setTasks(result.tasks))
      .finally(() => setLoading(false));
  }, [disclosure.isOpen, status]);
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose} size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Архив</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            mb={4}
          >
            <option value="all">Все</option>
            <option value="COMPLETED">Выполненные</option>
            <option value="CANCELED">Отменённые</option>
          </Select>
          {loading ? (
            <Spinner />
          ) : (
            <Stack divider={<Divider />}>
              {tasks.length === 0 && (
                <Text color="shadcn.mutedForeground">Архив пуст</Text>
              )}
              {tasks.map((task) => (
                <Box key={task.id}>
                  <Badge
                    mb={1}
                    variant={
                      task.status === 'COMPLETED' ? 'success' : 'destructive'
                    }
                  >
                    {task.status === 'COMPLETED' ? 'Выполнено' : 'Отменено'}
                  </Badge>
                  <Text whiteSpace="pre-wrap">{task.content}</Text>
                  {task.attachments.length > 0 && (
                    <Box mt={3}>
                      <AttachmentsList
                        attachments={task.attachments}
                        compact
                      />
                    </Box>
                  )}
                  <Text fontSize="xs" color="shadcn.mutedForeground" mt={2}>
                    {formatDate(task.updatedAt)}
                  </Text>
                </Box>
              ))}
            </Stack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={disclosure.onClose}>Закрыть</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function HistoryModal({
  disclosure,
  task,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  task: Task | null;
}) {
  const [details, setDetails] = useState<TaskDetails | null>(null);
  useEffect(() => {
    if (disclosure.isOpen && task)
      void api<TaskDetails>(`/tasks/${task.id}`).then(setDetails);
  }, [disclosure.isOpen, task]);
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>История задачи</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {!details ? (
            <Spinner />
          ) : (
            <Stack spacing={4}>
              <Flex gap={2}>
                <Badge>Отложено: {details.stats.snoozed}</Badge>
                <Badge>Не сейчас: {details.stats.rotated}</Badge>
              </Flex>
              {details.events.map((event) => (
                <Box
                  key={event.id}
                  borderLeft="2px solid"
                  borderColor="shadcn.border"
                  pl={3}
                >
                  <Text fontWeight="semibold">{eventName(event.type)}</Text>
                  <Text fontSize="sm" color="shadcn.mutedForeground">
                    {formatDate(event.createdAt)}
                  </Text>
                </Box>
              ))}
            </Stack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={disclosure.onClose}>Закрыть</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function SettingsModal({
  disclosure,
  identity,
  onLinked,
}: {
  disclosure: ReturnType<typeof useDisclosure>;
  identity: Bootstrap['identity'] | null;
  onLinked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const link = async () => {
    setBusy(true);
    try {
      const result = await api<{ linked: boolean; authUrl: string | null }>(
        '/link/start',
        { method: 'POST' },
      );
      if (result.linked) {
        onLinked();
        return;
      }
      if (result.authUrl) {
        if (window.Telegram?.WebApp?.openLink)
          window.Telegram.WebApp.openLink(result.authUrl);
        else window.open(result.authUrl, '_blank', 'noopener');
      }
    } catch (reason) {
      toast({
        status: 'error',
        title: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={disclosure.isOpen} onClose={disclosure.onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Настройки</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <IdentityRow
              label="Текущий вход"
              value={identity?.provider === 'TELEGRAM' ? 'Telegram' : 'Google'}
            />
            <IdentityRow label="Аккаунт" value={identity?.displayName || '—'} />
            <IdentityRow
              label="Связь"
              value={
                identity?.linked
                  ? 'Google и Telegram связаны'
                  : 'Независимое пространство'
              }
            />
            {identity?.provider === 'TELEGRAM' && !identity.linked && (
              <Button onClick={link} isLoading={busy} variant="primary">
                Привязать Google
              </Button>
            )}
            <Text fontSize="sm" color="shadcn.mutedForeground">
              Привязка опциональна. Без неё приложение продолжает работать
              самостоятельно.
            </Text>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={disclosure.onClose}>Закрыть</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="space-between" gap={4}>
      <Text color="shadcn.mutedForeground">{label}</Text>
      <Text fontWeight="semibold" textAlign="right">
        {value}
      </Text>
    </Flex>
  );
}

function eventName(type: string) {
  return (
    (
      {
        CREATED: 'Задача создана',
        UPDATED: 'Текст изменён',
        PROJECT_CHANGED: 'Проект изменён',
        SNOOZED: 'Задача отложена',
        ROTATED: 'Перемещена в конец',
        COMPLETED: 'Выполнена',
        CANCELED: 'Отменена',
        ATTACHMENT_ADDED: 'Добавлено вложение',
      } as Record<string, string>
    )[type] || type
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      minH="100vh"
      bg="shadcn.background"
      color="shadcn.foreground"
      px={{ base: 4, md: 8 }}
      pt={{ base: 'max(20px, env(safe-area-inset-top))', md: 8 }}
      pb={{ base: 'max(24px, env(safe-area-inset-bottom))', md: 8 }}
    >
      <Box maxW="760px" mx="auto">
        {children}
      </Box>
    </Box>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      border="1px solid"
      borderColor="shadcn.border"
      borderRadius="lg"
      bg="shadcn.card"
      color="shadcn.cardForeground"
      p={{ base: 5, md: 7 }}
      shadow="sm"
    >
      {children}
    </Box>
  );
}
