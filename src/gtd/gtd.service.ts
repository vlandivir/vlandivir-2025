import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  GtdIdentityProvider,
  GtdTaskEventType,
  GtdTaskStatus,
  type Prisma,
} from '../generated/prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../services/storage.service';
import type { GtdAuthContext } from './gtd-auth.service';

const MAX_CONTENT = 10_000;
const MAX_PROJECT_NAME = 120;
export const GTD_MAX_ATTACHMENTS = 10;
export const GTD_MAX_FILE_BYTES = 20 * 1024 * 1024;
type Scope = { kind: 'all' | 'inbox' | 'project'; projectId?: string };
export type GtdAction =
  | 'ROTATE'
  | 'SNOOZE_HOUR'
  | 'SNOOZE_TOMORROW'
  | 'SNOOZE_MONDAY'
  | 'SNOOZE_WEEK'
  | 'COMPLETE'
  | 'CANCEL';

@Injectable()
export class GtdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  private readonly taskInclude = {
    project: true,
    attachments: { orderBy: { createdAt: 'asc' as const } },
  };

  async bootstrap(auth: GtdAuthContext, scope: Scope) {
    const now = new Date();
    const scopeWhere = this.scopeWhere(scope);
    if (scope.kind === 'project')
      await this.requireProject(auth.workspaceId, scope.projectId || '', false);
    const eligible = {
      workspaceId: auth.workspaceId,
      status: GtdTaskStatus.ACTIVE,
      ...scopeWhere,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    };
    const [workspace, projects, current, availableCount, activeCount, next] =
      await Promise.all([
        this.prisma.gtdWorkspace.findUniqueOrThrow({
          where: { id: auth.workspaceId },
          include: {
            identities: { select: { provider: true, displayName: true } },
          },
        }),
        this.prisma.gtdProject.findMany({
          where: { workspaceId: auth.workspaceId },
          orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.gtdTask.findFirst({
          where: eligible,
          orderBy: [{ orderKey: 'asc' }, { id: 'asc' }],
          include: this.taskInclude,
        }),
        this.prisma.gtdTask.count({ where: eligible }),
        this.prisma.gtdTask.count({
          where: {
            workspaceId: auth.workspaceId,
            status: GtdTaskStatus.ACTIVE,
            ...scopeWhere,
          },
        }),
        this.prisma.gtdTask.findFirst({
          where: {
            workspaceId: auth.workspaceId,
            status: GtdTaskStatus.ACTIVE,
            ...scopeWhere,
            snoozedUntil: { gt: now },
          },
          orderBy: { snoozedUntil: 'asc' },
          select: { snoozedUntil: true },
        }),
      ]);
    return {
      identity: {
        provider: auth.identity.provider,
        displayName: auth.identity.displayName,
        linked: workspace.identities.length > 1,
        providers: workspace.identities.map((item) => item.provider),
      },
      projects: projects.map((project) => ({
        ...project,
        archived: Boolean(project.archivedAt),
      })),
      currentTask: current ? this.serializeTask(current) : null,
      counts: { available: availableCount, active: activeCount },
      nextWakeAt: next?.snoozedUntil?.toISOString() || null,
    };
  }

  createProject(workspaceId: string, nameValue: unknown) {
    return this.prisma.gtdProject.create({
      data: { workspaceId, name: this.projectName(nameValue) },
    });
  }

  async updateProject(
    workspaceId: string,
    projectId: string,
    body: { name?: unknown; archived?: unknown },
  ) {
    const project = await this.requireProject(workspaceId, projectId, true);
    const data: Prisma.GtdProjectUpdateInput = {};
    if (body.name !== undefined) data.name = this.projectName(body.name);
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean')
        throw new BadRequestException('archived must be boolean');
      data.archivedAt = body.archived ? new Date() : null;
    }
    if (!Object.keys(data).length)
      throw new BadRequestException('Nothing to update');
    return this.prisma.gtdProject.update({ where: { id: project.id }, data });
  }

  async createTask(
    workspaceId: string,
    contentValue: unknown,
    projectId?: unknown,
  ) {
    const content = this.content(contentValue);
    const project = await this.optionalActiveProject(workspaceId, projectId);
    return this.prisma.$transaction(async (tx) => {
      const orderKey = await this.frontOrder(tx, workspaceId);
      const task = await tx.gtdTask.create({
        data: {
          workspaceId,
          projectId: project?.id,
          content,
          orderKey,
          events: { create: { type: GtdTaskEventType.CREATED } },
        },
        include: this.taskInclude,
      });
      return this.serializeTask(task);
    });
  }

  async updateTask(
    workspaceId: string,
    taskId: string,
    body: { content?: unknown; projectId?: unknown },
  ) {
    const task = await this.requireTask(workspaceId, taskId, true);
    const data: Prisma.GtdTaskUpdateInput = {};
    const events: Prisma.GtdTaskEventCreateWithoutTaskInput[] = [];
    if (body.content !== undefined) {
      const content = this.content(body.content);
      data.content = content;
      if (content !== task.content)
        events.push({
          type: GtdTaskEventType.UPDATED,
          metadata: { previousContent: task.content },
        });
    }
    if (body.projectId !== undefined) {
      const requestedProjectId =
        body.projectId === null || body.projectId === ''
          ? null
          : body.projectId;
      if (
        requestedProjectId !== null &&
        typeof requestedProjectId !== 'string'
      ) {
        throw new BadRequestException('projectId must be a string or null');
      }
      if (requestedProjectId !== task.projectId) {
        const project = await this.optionalActiveProject(
          workspaceId,
          requestedProjectId,
        );
        const nextProjectId = project?.id || null;
        data.project = nextProjectId
          ? { connect: { id: nextProjectId } }
          : { disconnect: true };
        events.push({
          type: GtdTaskEventType.PROJECT_CHANGED,
          metadata: {
            previousProjectId: task.projectId,
            projectId: nextProjectId,
          },
        });
      }
    }
    if (!Object.keys(data).length)
      throw new BadRequestException('Nothing to update');
    const updated = await this.prisma.gtdTask.update({
      where: { id: task.id },
      data: { ...data, events: events.length ? { create: events } : undefined },
      include: this.taskInclude,
    });
    return this.serializeTask(updated);
  }

  async act(workspaceId: string, taskId: string, actionValue: unknown) {
    const action = String(actionValue || '') as GtdAction;
    const allowed: GtdAction[] = [
      'ROTATE',
      'SNOOZE_HOUR',
      'SNOOZE_TOMORROW',
      'SNOOZE_MONDAY',
      'SNOOZE_WEEK',
      'COMPLETE',
      'CANCEL',
    ];
    if (!allowed.includes(action))
      throw new BadRequestException('Invalid action');
    await this.requireTask(workspaceId, taskId, true);
    const now = new Date();
    // Must serialize: Prisma returns orderKey as bigint, and Nest JSON
    // serialization throws "Do not know how to serialize a BigInt" → 500
    // even though the DB write already succeeded (hence the UI toast).
    const updated = await this.prisma.$transaction(async (tx) => {
      if (action === 'ROTATE')
        return tx.gtdTask.update({
          where: { id: taskId },
          data: {
            orderKey: await this.nextOrder(tx, workspaceId),
            events: { create: { type: GtdTaskEventType.ROTATED } },
          },
        });
      if (action.startsWith('SNOOZE_')) {
        const until = this.snoozeUntil(action, now);
        return tx.gtdTask.update({
          where: { id: taskId },
          data: {
            snoozedUntil: until,
            events: {
              create: {
                type: GtdTaskEventType.SNOOZED,
                metadata: { preset: action, until: until.toISOString() },
              },
            },
          },
        });
      }
      return tx.gtdTask.update({
        where: { id: taskId },
        data:
          action === 'COMPLETE'
            ? {
                status: GtdTaskStatus.COMPLETED,
                completedAt: now,
                events: { create: { type: GtdTaskEventType.COMPLETED } },
              }
            : {
                status: GtdTaskStatus.CANCELED,
                canceledAt: now,
                events: { create: { type: GtdTaskEventType.CANCELED } },
              },
      });
    });
    return this.serializeTask(updated);
  }

  async taskDetails(workspaceId: string, taskId: string) {
    const task = await this.prisma.gtdTask.findFirst({
      where: { id: taskId, workspaceId },
      include: {
        ...this.taskInclude,
        events: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return {
      ...this.serializeTask(task),
      events: task.events,
      stats: {
        snoozed: task.events.filter(
          (event) => event.type === GtdTaskEventType.SNOOZED,
        ).length,
        rotated: task.events.filter(
          (event) => event.type === GtdTaskEventType.ROTATED,
        ).length,
      },
    };
  }

  async archive(workspaceId: string, cursor?: string, status?: string) {
    const where: Prisma.GtdTaskWhereInput = {
      workspaceId,
      status:
        status === 'COMPLETED'
          ? GtdTaskStatus.COMPLETED
          : status === 'CANCELED'
            ? GtdTaskStatus.CANCELED
            : { in: [GtdTaskStatus.COMPLETED, GtdTaskStatus.CANCELED] },
    };
    const tasks = await this.prisma.gtdTask.findMany({
      where,
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { project: true, attachments: true },
    });
    const hasMore = tasks.length > 20;
    const page = hasMore ? tasks.slice(0, 20) : tasks;
    return {
      tasks: page.map((task) => this.serializeTask(task)),
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    };
  }

  async addAttachment(
    workspaceId: string,
    taskId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size: number;
    },
  ) {
    await this.requireTask(workspaceId, taskId, true);
    if (!this.allowedMime(file.mimetype))
      throw new BadRequestException('Unsupported file type');
    if (file.size <= 0 || file.size > GTD_MAX_FILE_BYTES)
      throw new BadRequestException('File is too large');
    if (
      (await this.prisma.gtdAttachment.count({ where: { taskId } })) >=
      GTD_MAX_ATTACHMENTS
    )
      throw new BadRequestException('Attachment limit reached');
    const safeName =
      file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180) || 'file';
    const storageKey = `gtd/${workspaceId}/${taskId}/${randomUUID()}-${safeName}`;
    await this.storage.uploadPrivateFileWithKey(
      file.buffer,
      file.mimetype,
      storageKey,
    );
    const task = await this.prisma.gtdTask.update({
      where: { id: taskId },
      data: {
        attachments: {
          create: {
            storageKey,
            originalName: file.originalname.slice(0, 255),
            mimeType: file.mimetype,
            size: file.size,
          },
        },
        events: {
          create: {
            type: GtdTaskEventType.ATTACHMENT_ADDED,
            metadata: { originalName: file.originalname, size: file.size },
          },
        },
      },
      include: this.taskInclude,
    });
    return this.serializeTask(task);
  }

  async downloadAttachment(workspaceId: string, attachmentId: string) {
    const attachment = await this.prisma.gtdAttachment.findFirst({
      where: { id: attachmentId, task: { workspaceId } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return {
      attachment,
      buffer: await this.storage.downloadByKey(attachment.storageKey),
    };
  }

  async startLink(auth: GtdAuthContext, baseUrl: string) {
    if (auth.identity.provider !== GtdIdentityProvider.TELEGRAM)
      throw new BadRequestException('Start linking from Telegram');
    const identities = await this.prisma.gtdIdentity.findMany({
      where: { workspaceId: auth.workspaceId },
    });
    if (
      identities.some(
        (identity) => identity.provider === GtdIdentityProvider.GOOGLE,
      )
    )
      return { linked: true, authUrl: null };
    const token = randomBytes(32).toString('hex');
    await this.prisma.gtdLinkRequest.create({
      data: {
        tokenHash: this.hashToken(token),
        telegramIdentityId: auth.identity.id,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const redirect = `/gtd/link?token=${encodeURIComponent(token)}`;
    return {
      linked: false,
      authUrl: `${baseUrl}/auth/google?redirect=${encodeURIComponent(redirect)}`,
    };
  }

  async linkPreview(auth: GtdAuthContext, token: string) {
    this.requireGoogle(auth);
    const request = await this.validLinkRequest(token);
    return {
      google: auth.identity.displayName || auth.identity.providerId,
      telegram:
        request.telegramIdentity.displayName ||
        request.telegramIdentity.providerId,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async confirmLink(auth: GtdAuthContext, token: string) {
    this.requireGoogle(auth);
    const request = await this.validLinkRequest(token, true);
    const telegramIdentity = request.telegramIdentity;
    if (request.consumedAt) {
      if (telegramIdentity.workspaceId === auth.workspaceId) {
        return { linked: true };
      }
      throw new BadRequestException('Link request is invalid or expired');
    }
    if (telegramIdentity.workspaceId === auth.workspaceId) {
      await this.prisma.gtdLinkRequest.update({
        where: { id: request.id },
        data: { consumedAt: new Date() },
      });
      return { linked: true };
    }
    await this.prisma.$transaction(async (tx) => {
      const targetIdentities = await tx.gtdIdentity.findMany({
        where: { workspaceId: auth.workspaceId },
      });
      if (
        targetIdentities.some(
          (identity) =>
            identity.provider === GtdIdentityProvider.TELEGRAM &&
            identity.id !== telegramIdentity.id,
        )
      )
        throw new ConflictException(
          'Google account is already linked to another Telegram account',
        );
      const sourceIdentities = await tx.gtdIdentity.findMany({
        where: { workspaceId: telegramIdentity.workspaceId },
      });
      if (
        sourceIdentities.some(
          (identity) => identity.provider === GtdIdentityProvider.GOOGLE,
        )
      )
        throw new ConflictException(
          'Telegram account is already linked to another Google account',
        );
      const sourceTasks = await tx.gtdTask.findMany({
        where: { workspaceId: telegramIdentity.workspaceId },
        orderBy: [{ orderKey: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const target = await tx.gtdWorkspace.findUniqueOrThrow({
        where: { id: auth.workspaceId },
      });
      await tx.gtdProject.updateMany({
        where: { workspaceId: telegramIdentity.workspaceId },
        data: { workspaceId: auth.workspaceId },
      });
      let order = target.nextOrder;
      for (const task of sourceTasks) {
        order += 1n;
        await tx.gtdTask.update({
          where: { id: task.id },
          data: { workspaceId: auth.workspaceId, orderKey: order },
        });
      }
      await tx.gtdWorkspace.update({
        where: { id: auth.workspaceId },
        data: { nextOrder: order },
      });
      await tx.gtdIdentity.update({
        where: { id: telegramIdentity.id },
        data: { workspaceId: auth.workspaceId },
      });
      await tx.gtdLinkRequest.update({
        where: { id: request.id },
        data: { consumedAt: new Date() },
      });
      await tx.gtdWorkspace.delete({
        where: { id: telegramIdentity.workspaceId },
      });
    });
    return { linked: true };
  }

  private serializeTask<T extends { orderKey: bigint }>(task: T) {
    return { ...task, orderKey: task.orderKey.toString() };
  }
  private scopeWhere(scope: Scope): Prisma.GtdTaskWhereInput {
    return scope.kind === 'inbox'
      ? { projectId: null }
      : scope.kind === 'project'
        ? { projectId: scope.projectId }
        : {};
  }
  private async nextOrder(tx: Prisma.TransactionClient, workspaceId: string) {
    return (
      await tx.gtdWorkspace.update({
        where: { id: workspaceId },
        data: { nextOrder: { increment: 1 } },
        select: { nextOrder: true },
      })
    ).nextOrder;
  }
  /** Place a new task before every existing one so it becomes current immediately. */
  private async frontOrder(tx: Prisma.TransactionClient, workspaceId: string) {
    // Serialize concurrent creates against the workspace row (same lock as nextOrder).
    await tx.gtdWorkspace.update({
      where: { id: workspaceId },
      data: { nextOrder: { increment: 0 } },
      select: { id: true },
    });
    const min = await tx.gtdTask.aggregate({
      where: { workspaceId },
      _min: { orderKey: true },
    });
    if (min._min.orderKey == null) return this.nextOrder(tx, workspaceId);
    return min._min.orderKey - 1n;
  }
  private content(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > MAX_CONTENT
    )
      throw new BadRequestException(
        `content must be 1-${MAX_CONTENT} characters`,
      );
    return value.trim();
  }
  private projectName(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > MAX_PROJECT_NAME
    )
      throw new BadRequestException(
        `name must be 1-${MAX_PROJECT_NAME} characters`,
      );
    return value.trim();
  }
  private async optionalActiveProject(workspaceId: string, value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string')
      throw new BadRequestException('projectId must be a string or null');
    return this.requireProject(workspaceId, value, false);
  }
  private async requireProject(
    workspaceId: string,
    projectId: string,
    allowArchived: boolean,
  ) {
    const project = await this.prisma.gtdProject.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!allowArchived && project.archivedAt)
      throw new BadRequestException('Project is archived');
    return project;
  }
  private async requireTask(
    workspaceId: string,
    taskId: string,
    activeOnly: boolean,
  ) {
    const task = await this.prisma.gtdTask.findFirst({
      where: { id: taskId, workspaceId },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (activeOnly && task.status !== GtdTaskStatus.ACTIVE)
      throw new BadRequestException('Task is not active');
    return task;
  }
  private snoozeUntil(action: GtdAction, now: Date) {
    if (action === 'SNOOZE_HOUR') return new Date(now.getTime() + 3_600_000);
    if (action === 'SNOOZE_WEEK') return new Date(now.getTime() + 604_800_000);
    if (action === 'SNOOZE_TOMORROW')
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          9,
        ),
      );
    const candidate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9),
    );
    candidate.setUTCDate(
      candidate.getUTCDate() + ((8 - candidate.getUTCDay()) % 7),
    );
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }
  private allowedMime(mime: string) {
    return (
      [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif',
        'image/heic',
        'image/heif',
      ].includes(mime) ||
      [
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'video/x-m4v',
        'video/3gpp',
      ].includes(mime) ||
      [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ].includes(mime)
    );
  }
  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private async validLinkRequest(token: string, allowConsumed = false) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new BadRequestException('Invalid link token');
    const request = await this.prisma.gtdLinkRequest.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { telegramIdentity: true },
    });
    if (
      !request ||
      (!allowConsumed && request.consumedAt) ||
      request.expiresAt <= new Date()
    )
      throw new BadRequestException('Link request is invalid or expired');
    return request;
  }
  private requireGoogle(auth: GtdAuthContext) {
    if (auth.identity.provider !== GtdIdentityProvider.GOOGLE)
      throw new BadRequestException('Google authentication required');
  }
}
