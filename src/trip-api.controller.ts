import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './auth/auth.service';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './services/storage.service';
import { TripThumbsService } from './services/trip-thumbs.service';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const MAX_TITLE_LEN = 200;
const MAX_NAME_LEN = 80;
const MAX_FILENAME_LEN = 255;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONTRIBUTOR_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CreateTripBody = {
  title?: string;
  displayName?: string;
  contributorId?: string;
};

type PatchTripBody = {
  title?: string;
};

type UploadCheckBody = {
  contentHash?: string;
  mimeType?: string;
  size?: number | string;
  originalFilename?: string;
  contributorId?: string;
  displayName?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  takenAt?: string | null;
};

type UploadCompleteBody = UploadCheckBody;

@Controller('trip-api')
export class TripApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly authService: AuthService,
    private readonly tripThumbs: TripThumbsService,
  ) {}

  @Post('trips')
  async createTrip(@Body() body: CreateTripBody) {
    const title = this.requireTitle(body.title);
    const displayName = this.requireDisplayName(body.displayName);
    const contributorId = this.requireContributorId(body.contributorId);
    const secret = uuidv4();

    const trip = await this.prisma.trip.create({
      data: {
        secret,
        title,
        ownerContributorId: contributorId,
      },
    });

    return {
      id: trip.id,
      secret: trip.secret,
      title: trip.title,
      ownerContributorId: trip.ownerContributorId,
      displayName,
      pageUrl: `/trip/${trip.secret}`,
      createdAt: trip.createdAt.toISOString(),
    };
  }

  @Get('trips/:secret')
  async getTrip(@Param('secret') secret: string, @Req() req: Request) {
    const trip = await this.findTripOrThrow(secret);
    const isAdmin = this.authService.isAdminSession(req);
    return {
      id: trip.id,
      secret: trip.secret,
      title: trip.title,
      ownerContributorId: trip.ownerContributorId,
      isAdmin,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }

  @Patch('trips/:secret')
  async patchTrip(
    @Param('secret') secret: string,
    @Body() body: PatchTripBody,
    @Headers('x-contributor-id') contributorHeader?: string,
  ) {
    const trip = await this.findTripOrThrow(secret);
    const contributorId = this.requireContributorId(contributorHeader);
    if (contributorId !== trip.ownerContributorId) {
      throw new ForbiddenException('Only the trip creator can rename it');
    }
    const title = this.requireTitle(body.title);
    const updated = await this.prisma.trip.update({
      where: { id: trip.id },
      data: { title },
    });
    return {
      id: updated.id,
      secret: updated.secret,
      title: updated.title,
      ownerContributorId: updated.ownerContributorId,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  @Get('trips/:secret/media')
  async listMedia(@Param('secret') secret: string, @Req() req: Request) {
    const trip = await this.findTripOrThrow(secret);
    const isAdmin = this.authService.isAdminSession(req);
    const rows = await this.prisma.tripMedia.findMany({
      where: isAdmin
        ? { tripId: trip.id }
        : { tripId: trip.id, deletedAt: null },
      orderBy: [
        { takenAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    // Lazily backfill thumbs / capture metadata (EXIF, device).
    for (const row of rows) {
      if (!row.thumbUrl || row.cameraModel == null) {
        this.tripThumbs.generateInBackground(row);
      }
    }
    return {
      isAdmin,
      media: rows.map((row) => this.serializeMedia(row)),
    };
  }

  @Post('trips/:secret/uploads/check')
  async checkUpload(
    @Param('secret') secret: string,
    @Body() body: UploadCheckBody,
    @Req() req: Request,
  ) {
    const trip = await this.findTripOrThrow(secret);
    const meta = this.parseUploadMeta(body, req);

    const existing = await this.prisma.tripMedia.findUnique({
      where: {
        tripId_contentHash: {
          tripId: trip.id,
          contentHash: meta.contentHash,
        },
      },
    });

    if (existing && !existing.deletedAt) {
      return {
        status: 'alreadyExists' as const,
        media: this.serializeMedia(existing),
      };
    }

    if (existing?.deletedAt && existing.contributorId === meta.contributorId) {
      const restored = await this.prisma.tripMedia.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          displayName: meta.displayName,
          userAgent: meta.userAgent,
          originalFilename: meta.originalFilename,
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          takenAt: meta.takenAt,
        },
      });
      return {
        status: 'restored' as const,
        media: this.serializeMedia(restored),
      };
    }

    if (existing?.deletedAt) {
      return {
        status: 'alreadyExists' as const,
        media: this.serializeMedia(existing),
      };
    }

    const { uploadUrl, publicUrl } =
      await this.storage.getTripMediaPresignedPutUrl(
        trip.id,
        meta.contentHash,
        meta.originalFilename,
        meta.mimeType,
      );

    return {
      status: 'ok' as const,
      uploadUrl,
      publicUrl,
      headers: {
        'Content-Type': meta.mimeType,
        'x-amz-acl': 'public-read',
      },
    };
  }

  @Post('trips/:secret/uploads/complete')
  async completeUpload(
    @Param('secret') secret: string,
    @Body() body: UploadCompleteBody,
    @Req() req: Request,
  ) {
    const trip = await this.findTripOrThrow(secret);
    const meta = this.parseUploadMeta(body, req);

    const existing = await this.prisma.tripMedia.findUnique({
      where: {
        tripId_contentHash: {
          tripId: trip.id,
          contentHash: meta.contentHash,
        },
      },
    });

    if (existing && !existing.deletedAt) {
      await this.ensureThumbFor(existing);
      const fresh = await this.prisma.tripMedia.findUniqueOrThrow({
        where: { id: existing.id },
      });
      return {
        status: 'alreadyExists' as const,
        media: this.serializeMedia(fresh),
      };
    }

    if (existing?.deletedAt && existing.contributorId === meta.contributorId) {
      const restored = await this.prisma.tripMedia.update({
        where: { id: existing.id },
        data: { deletedAt: null, displayName: meta.displayName },
      });
      await this.ensureThumbFor(restored);
      const fresh = await this.prisma.tripMedia.findUniqueOrThrow({
        where: { id: restored.id },
      });
      return {
        status: 'restored' as const,
        media: this.serializeMedia(fresh),
      };
    }

    if (existing?.deletedAt) {
      return {
        status: 'alreadyExists' as const,
        media: this.serializeMedia(existing),
      };
    }

    const head = await this.storage.headTripMedia(
      trip.id,
      meta.contentHash,
      meta.originalFilename,
    );
    if (!head) {
      throw new BadRequestException(
        'File not found in storage; upload may have failed',
      );
    }

    const url = this.storage.getTripMediaPublicUrl(
      trip.id,
      meta.contentHash,
      meta.originalFilename,
    );

    try {
      const created = await this.prisma.tripMedia.create({
        data: {
          tripId: trip.id,
          contentHash: meta.contentHash,
          url,
          mimeType: meta.mimeType,
          size: BigInt(meta.size),
          originalFilename: meta.originalFilename,
          kind: meta.kind,
          contributorId: meta.contributorId,
          displayName: meta.displayName,
          userAgent: meta.userAgent,
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          takenAt: meta.takenAt,
        },
      });
      await this.ensureThumbFor(created);
      const fresh = await this.prisma.tripMedia.findUniqueOrThrow({
        where: { id: created.id },
      });
      return {
        status: 'created' as const,
        media: this.serializeMedia(fresh),
      };
    } catch (error) {
      // Race: another complete won the unique constraint.
      const raced = await this.prisma.tripMedia.findUnique({
        where: {
          tripId_contentHash: {
            tripId: trip.id,
            contentHash: meta.contentHash,
          },
        },
      });
      if (raced) {
        await this.ensureThumbFor(raced);
        const fresh = await this.prisma.tripMedia.findUniqueOrThrow({
          where: { id: raced.id },
        });
        return {
          status: 'alreadyExists' as const,
          media: this.serializeMedia(fresh),
        };
      }
      throw error;
    }
  }

  @Delete('trips/:secret/media/:id')
  async softDeleteMedia(
    @Param('secret') secret: string,
    @Param('id') id: string,
    @Headers('x-contributor-id') contributorHeader: string | undefined,
    @Req() req: Request,
  ) {
    const trip = await this.findTripOrThrow(secret);
    const isAdmin = this.authService.isAdminSession(req);
    const media = await this.prisma.tripMedia.findFirst({
      where: { id, tripId: trip.id },
    });
    if (!media) throw new NotFoundException('Media not found');
    if (media.deletedAt) {
      return {
        status: 'alreadyDeleted' as const,
        media: this.serializeMedia(media),
      };
    }

    if (!isAdmin) {
      const contributorId = this.requireContributorId(contributorHeader);
      if (contributorId !== media.contributorId) {
        throw new ForbiddenException('You can only delete your own uploads');
      }
    }

    const updated = await this.prisma.tripMedia.update({
      where: { id: media.id },
      data: { deletedAt: new Date() },
    });
    return {
      status: 'deleted' as const,
      media: this.serializeMedia(updated),
    };
  }

  private async findTripOrThrow(secret: string) {
    if (!secret || secret.length < 8 || secret.length > 80) {
      throw new NotFoundException('Trip not found');
    }
    const trip = await this.prisma.trip.findUnique({ where: { secret } });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  private parseUploadMeta(body: UploadCheckBody, req: Request) {
    const contentHash = (body.contentHash || '').trim().toLowerCase();
    if (!SHA256_HEX.test(contentHash)) {
      throw new BadRequestException('contentHash must be a sha256 hex string');
    }

    const mimeType = (body.mimeType || '').trim().toLowerCase();
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      throw new BadRequestException('Only image/* and video/* are allowed');
    }

    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
      throw new BadRequestException(
        `size must be between 1 and ${MAX_FILE_BYTES} bytes`,
      );
    }

    const originalFilename = (body.originalFilename || 'file')
      .trim()
      .slice(0, MAX_FILENAME_LEN);
    if (!originalFilename) {
      throw new BadRequestException('originalFilename is required');
    }

    const contributorId = this.requireContributorId(body.contributorId);
    const displayName = this.requireDisplayName(body.displayName);
    const kind = mimeType.startsWith('video/') ? 'video' : 'photo';

    const width = this.optionalPositiveInt(body.width);
    const height = this.optionalPositiveInt(body.height);
    const durationMs = this.optionalPositiveInt(body.durationMs);
    let takenAt: Date | null = null;
    if (body.takenAt) {
      const parsed = new Date(body.takenAt);
      if (!Number.isNaN(parsed.getTime())) takenAt = parsed;
    }

    return {
      contentHash,
      mimeType,
      size,
      originalFilename,
      contributorId,
      displayName,
      kind,
      userAgent: (req.headers['user-agent'] || '').slice(0, 500) || null,
      width,
      height,
      durationMs,
      takenAt,
    };
  }

  private requireTitle(value?: string): string {
    const title = (value || '').trim();
    if (!title) throw new BadRequestException('title is required');
    if (title.length > MAX_TITLE_LEN) {
      throw new BadRequestException(`title max length is ${MAX_TITLE_LEN}`);
    }
    return title;
  }

  private requireDisplayName(value?: string): string {
    const name = (value || '').trim();
    if (!name) throw new BadRequestException('displayName is required');
    if (name.length > MAX_NAME_LEN) {
      throw new BadRequestException(
        `displayName max length is ${MAX_NAME_LEN}`,
      );
    }
    return name;
  }

  private requireContributorId(value?: string): string {
    const id = (value || '').trim();
    if (!CONTRIBUTOR_ID.test(id)) {
      throw new BadRequestException('contributorId must be a UUID');
    }
    return id.toLowerCase();
  }

  private optionalPositiveInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
    return Math.round(n);
  }

  private async ensureThumbFor(media: {
    id: string;
    tripId: string;
    contentHash: string;
    url: string;
    mimeType: string;
    size: bigint;
    originalFilename: string;
    kind: string;
    thumbUrl: string | null;
  }): Promise<void> {
    if (media.thumbUrl) return;
    // Photos: wait so the gallery can use a cheap JPEG immediately.
    // Videos: ffmpeg frame extract in the background (can take a few seconds).
    if (media.kind === 'photo') {
      await this.tripThumbs.ensureThumb(media);
      return;
    }
    this.tripThumbs.generateInBackground(media);
  }

  private serializeMedia(row: {
    id: string;
    tripId: string;
    contentHash: string;
    url: string;
    thumbUrl: string | null;
    mimeType: string;
    size: bigint;
    originalFilename: string;
    kind: string;
    contributorId: string;
    displayName: string;
    userAgent: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    takenAt: Date | null;
    cameraModel: string | null;
    createdAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: row.id,
      tripId: row.tripId,
      contentHash: row.contentHash,
      url: row.url,
      thumbUrl: row.thumbUrl,
      mimeType: row.mimeType,
      size: Number(row.size),
      originalFilename: row.originalFilename,
      kind: row.kind,
      contributorId: row.contributorId,
      displayName: row.displayName,
      userAgent: row.userAgent,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      takenAt: row.takenAt?.toISOString() ?? null,
      cameraModel: row.cameraModel ? row.cameraModel : null,
      metaReady: row.cameraModel != null,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      deleted: Boolean(row.deletedAt),
    };
  }
}
