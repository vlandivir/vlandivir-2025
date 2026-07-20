import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { ReelsService } from './reels.service';

export interface MapSearchHit {
  type: 'point' | 'track';
  id: number;
  similarity: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Map-linked reels are a small subset, so keep the bar low: we want relevant
// recommendations, not just near-exact matches.
const MIN_SIMILARITY = 0.2;

@Injectable()
export class MapSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly reelsService: ReelsService,
  ) {}

  /**
   * Semantic search over map features that have an attached Instagram reel.
   * The reels already carry embeddings (title + description + tags +
   * transcript + on-screen description), so we reuse them and only return the
   * map points/tracks whose reel matches the query, ranked by similarity.
   */
  async search(query: string, limit = DEFAULT_LIMIT): Promise<MapSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const take = Math.min(
      Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    // Map every linked reel shortcode to the feature(s) that reference it.
    const [points, tracks] = await Promise.all([
      this.prisma.mapPoint.findMany({
        where: { instagramUrl: { not: null } },
        select: { id: true, instagramUrl: true },
      }),
      this.prisma.mapTrack.findMany({
        where: { instagramUrl: { not: null } },
        select: { id: true, instagramUrl: true },
      }),
    ]);

    const featuresByShortcode = new Map<
      string,
      { type: 'point' | 'track'; id: number }[]
    >();
    const addFeature = (
      instagramUrl: string | null,
      feature: { type: 'point' | 'track'; id: number },
    ) => {
      if (!instagramUrl) return;
      const shortcode = this.reelsService.extractShortcode(instagramUrl);
      if (!shortcode) return;
      const list = featuresByShortcode.get(shortcode) ?? [];
      list.push(feature);
      featuresByShortcode.set(shortcode, list);
    };
    for (const point of points) {
      addFeature(point.instagramUrl, { type: 'point', id: point.id });
    }
    for (const track of tracks) {
      addFeature(track.instagramUrl, { type: 'track', id: track.id });
    }
    if (!featuresByShortcode.size) return [];

    const reels = await this.prisma.reel.findMany({
      where: { shortcode: { in: [...featuresByShortcode.keys()] } },
      select: { id: true, shortcode: true },
    });
    if (!reels.length) return [];

    const featuresByReelId = new Map<
      number,
      { type: 'point' | 'track'; id: number }[]
    >();
    for (const reel of reels) {
      const features = featuresByShortcode.get(reel.shortcode);
      if (features) featuresByReelId.set(reel.id, features);
    }
    const reelIds = [...featuresByReelId.keys()];
    if (!reelIds.length) return [];

    // Over-fetch reel hits: several reels can point at the same feature, and
    // we dedupe to unique features afterwards.
    const hits = await this.embeddingsService.search('reel', q, {
      limit: Math.min(take * 3, MAX_LIMIT * 3),
      minSimilarity: MIN_SIMILARITY,
      refIds: reelIds,
    });

    const bestByFeature = new Map<string, MapSearchHit>();
    for (const hit of hits) {
      const features = featuresByReelId.get(hit.refId);
      if (!features) continue;
      for (const feature of features) {
        const key = `${feature.type}:${feature.id}`;
        const existing = bestByFeature.get(key);
        if (!existing || hit.similarity > existing.similarity) {
          bestByFeature.set(key, {
            type: feature.type,
            id: feature.id,
            similarity: hit.similarity,
          });
        }
      }
    }

    return [...bestByFeature.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, take);
  }
}
