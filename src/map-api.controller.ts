import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Prisma } from './generated/prisma-client';
import { PrismaService } from './prisma/prisma.service';

type MapPointBody = {
  name?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  instagramUrl?: string;
};

type MapTrackBody = {
  name?: string;
  description?: string;
  instagramUrl?: string;
  points?: unknown;
};

const MAX_TRACK_POINTS = 5000;

const SERBIA_BOUNDS = {
  minLat: 41.5,
  maxLat: 46.5,
  minLng: 18.0,
  maxLng: 23.5,
};

@Controller('map-api')
export class MapApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get('points')
  async listPoints() {
    return this.prisma.mapPoint.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('points')
  async createPoint(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Body() body: MapPointBody,
  ) {
    this.assertApiKey(apiKey);

    const name = this.parseName(body.name);
    const { latitude, longitude } = this.parseCoordinates(
      body.latitude,
      body.longitude,
    );

    return this.prisma.mapPoint.create({
      data: {
        name,
        latitude,
        longitude,
        description: this.parseOptionalText(body.description),
        instagramUrl: this.parseInstagramUrl(body.instagramUrl),
      },
    });
  }

  @Patch('points/:id')
  async updatePoint(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MapPointBody,
  ) {
    this.assertApiKey(apiKey);
    await this.assertPointExists(id);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      data.name = this.parseName(body.name);
    }
    if (body.description !== undefined) {
      data.description = this.parseOptionalText(body.description);
    }
    if (body.instagramUrl !== undefined) {
      data.instagramUrl = this.parseInstagramUrl(body.instagramUrl);
    }
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const { latitude, longitude } = this.parseCoordinates(
        body.latitude,
        body.longitude,
      );
      data.latitude = latitude;
      data.longitude = longitude;
    }

    return this.prisma.mapPoint.update({ where: { id }, data });
  }

  @Delete('points/:id')
  async deletePoint(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertApiKey(apiKey);
    await this.assertPointExists(id);

    await this.prisma.mapPoint.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('tracks')
  async listTracks() {
    return this.prisma.mapTrack.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('tracks')
  async createTrack(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Body() body: MapTrackBody,
  ) {
    this.assertApiKey(apiKey);

    return this.prisma.mapTrack.create({
      data: {
        name: this.parseName(body.name),
        description: this.parseOptionalText(body.description),
        instagramUrl: this.parseInstagramUrl(body.instagramUrl),
        points: this.parseTrackPoints(body.points) as Prisma.InputJsonValue,
      },
    });
  }

  @Patch('tracks/:id')
  async updateTrack(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MapTrackBody,
  ) {
    this.assertApiKey(apiKey);
    const track = await this.prisma.mapTrack.findUnique({ where: { id } });
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      data.name = this.parseName(body.name);
    }
    if (body.description !== undefined) {
      data.description = this.parseOptionalText(body.description);
    }
    if (body.instagramUrl !== undefined) {
      data.instagramUrl = this.parseInstagramUrl(body.instagramUrl);
    }
    if (body.points !== undefined) {
      data.points = this.parseTrackPoints(body.points);
    }

    return this.prisma.mapTrack.update({ where: { id }, data });
  }

  @Delete('tracks/:id')
  async deleteTrack(
    @Headers('x-map-api-key') apiKey: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertApiKey(apiKey);
    const track = await this.prisma.mapTrack.findUnique({ where: { id } });
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    await this.prisma.mapTrack.delete({ where: { id } });
    return { deleted: true };
  }

  private parseTrackPoints(points: unknown): [number, number][] {
    if (!Array.isArray(points) || points.length < 2) {
      throw new BadRequestException(
        'Track must contain at least 2 points ([lat, lng] pairs)',
      );
    }
    if (points.length > MAX_TRACK_POINTS) {
      throw new BadRequestException(
        `Track must contain at most ${MAX_TRACK_POINTS} points`,
      );
    }

    return points.map((point) => {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        typeof point[0] !== 'number' ||
        typeof point[1] !== 'number'
      ) {
        throw new BadRequestException(
          'Each track point must be a [lat, lng] pair of numbers',
        );
      }
      const { latitude, longitude } = this.parseCoordinates(point[0], point[1]);
      return [latitude, longitude] as [number, number];
    });
  }

  @Post('key-check')
  checkKey(@Headers('x-map-api-key') apiKey: string | undefined) {
    this.assertApiKey(apiKey);
    return { ok: true };
  }

  // Short share links (maps.app.goo.gl) carry no coordinates; follow the
  // redirect server-side so the frontend can parse the expanded URL.
  @Get('resolve-google-link')
  async resolveGoogleLink(@Query('url') url: string | undefined) {
    if (typeof url !== 'string' || !url.trim()) {
      throw new BadRequestException('url query parameter is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new BadRequestException('url must be a valid URL');
    }

    const allowedHost =
      parsed.hostname === 'maps.app.goo.gl' ||
      parsed.hostname === 'goo.gl' ||
      /(^|\.)google\.[a-z.]{2,6}$/.test(parsed.hostname);
    if (parsed.protocol !== 'https:' || !allowedHost) {
      throw new BadRequestException('Only Google Maps links are supported');
    }

    const controller = new AbortController();
    try {
      const response = await fetch(parsed.toString(), {
        redirect: 'follow',
        signal: controller.signal,
      });
      const finalUrl = response.url;
      controller.abort();
      return { url: finalUrl };
    } catch {
      throw new BadRequestException('Could not resolve the link');
    }
  }

  private async assertPointExists(id: number): Promise<void> {
    const point = await this.prisma.mapPoint.findUnique({ where: { id } });
    if (!point) {
      throw new NotFoundException('Point not found');
    }
  }

  private parseName(name?: string): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Name is required');
    }
    return name.trim();
  }

  private parseOptionalText(text?: string): string | null {
    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }
    return text.trim();
  }

  private parseInstagramUrl(url?: string): string | null {
    if (typeof url !== 'string' || !url.trim()) {
      return null;
    }

    const trimmed = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException('Instagram URL must be a valid URL');
    }

    if (!/(^|\.)instagram\.com$/.test(parsed.hostname)) {
      throw new BadRequestException(
        'Instagram URL must point to instagram.com',
      );
    }

    return trimmed;
  }

  private parseCoordinates(
    latitude?: number,
    longitude?: number,
  ): { latitude: number; longitude: number } {
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      throw new BadRequestException(
        'Latitude and longitude are required numbers',
      );
    }

    if (
      latitude < SERBIA_BOUNDS.minLat ||
      latitude > SERBIA_BOUNDS.maxLat ||
      longitude < SERBIA_BOUNDS.minLng ||
      longitude > SERBIA_BOUNDS.maxLng
    ) {
      throw new BadRequestException(
        'Coordinates must be within the Serbia region',
      );
    }

    return { latitude, longitude };
  }

  private assertApiKey(receivedKey?: string): void {
    const expectedKey =
      this.configService.get<string>('MAP_API_KEY') ||
      this.configService.get<string>('NOTE_API_KEY');
    if (!expectedKey) {
      throw new InternalServerErrorException('MAP_API_KEY is not configured');
    }

    if (!receivedKey || !this.isSameSecret(receivedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private isSameSecret(receivedKey: string, expectedKey: string): boolean {
    const received = Buffer.from(receivedKey);
    const expected = Buffer.from(expectedKey);

    if (received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  }
}
