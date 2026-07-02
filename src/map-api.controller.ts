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
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma/prisma.service';

type MapPointBody = {
  name?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  instagramUrl?: string;
};

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

  @Post('key-check')
  checkKey(@Headers('x-map-api-key') apiKey: string | undefined) {
    this.assertApiKey(apiKey);
    return { ok: true };
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
