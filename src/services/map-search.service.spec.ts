import { Test, TestingModule } from '@nestjs/testing';
import { MapSearchService } from './map-search.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { ReelsService } from './reels.service';

const SHORTCODE_RE =
  /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

describe('MapSearchService.search', () => {
  let service: MapSearchService;
  let embeddingsSearch: jest.Mock;
  let pointFindMany: jest.Mock;
  let trackFindMany: jest.Mock;
  let reelFindMany: jest.Mock;

  beforeEach(async () => {
    pointFindMany = jest.fn();
    trackFindMany = jest.fn();
    reelFindMany = jest.fn();
    embeddingsSearch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapSearchService,
        {
          provide: PrismaService,
          useValue: {
            mapPoint: { findMany: pointFindMany },
            mapTrack: { findMany: trackFindMany },
            reel: { findMany: reelFindMany },
          },
        },
        { provide: EmbeddingsService, useValue: { search: embeddingsSearch } },
        {
          provide: ReelsService,
          useValue: {
            extractShortcode: (url: string) =>
              SHORTCODE_RE.exec(url)?.[1] ?? null,
          },
        },
      ],
    }).compile();

    service = module.get<MapSearchService>(MapSearchService);
  });

  it('returns map features linked to matching reels, ranked by similarity', async () => {
    pointFindMany.mockResolvedValue([
      { id: 1, instagramUrl: 'https://instagram.com/reel/AAA/' },
      { id: 2, instagramUrl: 'https://instagram.com/p/BBB/' },
    ]);
    trackFindMany.mockResolvedValue([
      { id: 10, instagramUrl: 'https://instagram.com/reel/CCC/' },
    ]);
    reelFindMany.mockResolvedValue([
      { id: 100, shortcode: 'AAA' },
      { id: 200, shortcode: 'BBB' },
      { id: 300, shortcode: 'CCC' },
    ]);
    embeddingsSearch.mockResolvedValue([
      { refId: 300, similarity: 0.9 },
      { refId: 100, similarity: 0.5 },
      { refId: 200, similarity: 0.4 },
    ]);

    const results = await service.search('озеро с красивым видом');

    expect(results).toEqual([
      { type: 'track', id: 10, similarity: 0.9 },
      { type: 'point', id: 1, similarity: 0.5 },
      { type: 'point', id: 2, similarity: 0.4 },
    ]);

    // Search is restricted to the reels that are actually linked from the map.
    const [, , options] = embeddingsSearch.mock.calls[0];
    expect([...options.refIds].sort((a: number, b: number) => a - b)).toEqual([
      100, 200, 300,
    ]);
  });

  it('short-circuits without calling the embeddings API when no reels are linked', async () => {
    pointFindMany.mockResolvedValue([]);
    trackFindMany.mockResolvedValue([]);

    const results = await service.search('куда поехать искупаться');

    expect(results).toEqual([]);
    expect(reelFindMany).not.toHaveBeenCalled();
    expect(embeddingsSearch).not.toHaveBeenCalled();
  });

  it('ignores an empty query', async () => {
    const results = await service.search('   ');
    expect(results).toEqual([]);
    expect(pointFindMany).not.toHaveBeenCalled();
    expect(embeddingsSearch).not.toHaveBeenCalled();
  });
});
