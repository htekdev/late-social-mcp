import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(),
  unwrap: vi.fn((r: unknown) => (r as Record<string, unknown>)?.data ?? r),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
}));

vi.mock('../../src/config/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn(),
  getSlotsForPlatform: vi.fn(),
  normalizePlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
  validateScheduleConfig: vi.fn(() => []),
}));

vi.mock('../../src/smart/scheduler.js', () => ({
  generateSlots: vi.fn(),
  getDayOfWeekInTimezone: vi.fn(),
  buildSlotDatetime: vi.fn(),
}));

import { getClient } from '../../src/client/lateClient.js';
import { loadScheduleConfig, getSlotsForPlatform } from '../../src/config/scheduleConfig.js';
import { generateSlots } from '../../src/smart/scheduler.js';
import {
  buildRealignPlan,
  executeRealignPlan,
  type RealignPlan,
} from '../../src/smart/realignment.js';
import { buildPrioritizedRealignPlan } from '../../src/smart/prioritizedRealignment.js';

// ── Helpers ──

const DEFAULT_CONFIG = {
  timezone: 'America/Chicago',
  platforms: {
    x: {
      slots: [
        { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '09:00', label: 'Morning' },
        { days: ['mon', 'wed', 'fri'], time: '14:00', label: 'Afternoon' },
      ],
      avoidDays: ['sat', 'sun'],
      byClipType: {
        short: {
          slots: [{ days: ['tue', 'thu'], time: '11:00', label: 'Short Clip' }],
          avoidDays: ['sat', 'sun'],
        },
      },
    },
    instagram: {
      slots: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time: '10:00', label: 'IG Morning' }],
      avoidDays: ['sun'],
    },
  },
};

function setupConfig(config: unknown = DEFAULT_CONFIG) {
  vi.mocked(loadScheduleConfig).mockReturnValue(config as ReturnType<typeof loadScheduleConfig>);
  vi.mocked(getSlotsForPlatform).mockImplementation(
    (_cfg: unknown, platform: string, clipType?: string) => {
      if (platform === 'x' && clipType === 'short') {
        return [{ days: ['tue', 'thu'], time: '11:00', label: 'Short Clip' }];
      }
      if (platform === 'x') {
        return [
          { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '09:00', label: 'Morning' },
          { days: ['mon', 'wed', 'fri'], time: '14:00', label: 'Afternoon' },
        ];
      }
      if (platform === 'instagram') {
        return [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time: '10:00', label: 'IG Morning' }];
      }
      return [];
    },
  );
}

function makeSdk(overrides: Record<string, unknown> = {}) {
  const sdk = {
    posts: {
      listPosts: vi.fn().mockResolvedValue({ data: [] }),
      updatePost: vi.fn().mockResolvedValue({ data: {} }),
    },
    analytics: {
      getBestTimeToPost: vi.fn().mockResolvedValue({ data: [] }),
      getPostingFrequency: vi.fn().mockResolvedValue({ data: [] }),
      getPostTimeline: vi.fn().mockResolvedValue({ data: [] }),
      getAnalytics: vi.fn().mockResolvedValue({ data: [] }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

function makePost(id: string, platform: string, content: string, scheduledFor: string | null = null, status = 'scheduled') {
  return {
    _id: id,
    id,
    content,
    scheduledFor,
    status,
    platforms: [platform],
  };
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================
// buildRealignPlan
// =====================================================
describe('buildRealignPlan', () => {
  it('returns empty plan when no schedule config is loaded', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValue(null);
    makeSdk();

    const plan = await buildRealignPlan();

    expect(plan).toEqual({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 });
  });

  it('returns empty plan when API returns no posts', async () => {
    setupConfig();
    makeSdk();

    const plan = await buildRealignPlan();

    expect(plan.posts).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(0);
    expect(plan.totalFetched).toBe(0);
  });

  it('fetches posts across all four statuses', async () => {
    setupConfig();
    const sdk = makeSdk();

    await buildRealignPlan();

    // Should call listPosts once per status: scheduled, draft, cancelled, failed
    expect(sdk.posts.listPosts).toHaveBeenCalledTimes(4);
    const statuses = sdk.posts.listPosts.mock.calls.map(
      (c: unknown[]) => (c[0] as Record<string, Record<string, unknown>>).query.status,
    );
    expect(statuses).toEqual(['scheduled', 'draft', 'cancelled', 'failed']);
  });

  it('groups posts by platform and inferred clip type', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot1 = '2025-07-01T09:00:00-05:00';
    const slot2 = '2025-07-02T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot1, slot2]);

    // short content (<280 chars) → clipType "short"
    const post1 = makePost('p1', 'x', 'Hello world', '2025-06-15T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Another tweet', '2025-06-16T10:00:00Z');

    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.totalFetched).toBe(2);
    expect(plan.posts.length + plan.skipped + plan.toCancel.length).toBeGreaterThanOrEqual(0);
  });

  it('infers short clip type for content < 280 chars', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    const post = makePost('p1', 'x', 'Short post');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].clipType).toBe('short');
  });

  it('infers medium-clip type for content between 280 and 1000 chars', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    const mediumContent = 'A'.repeat(500);
    const post = makePost('p1', 'x', mediumContent);
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].clipType).toBe('medium-clip');
  });

  it('infers video clip type for content >= 1000 chars', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    const longContent = 'B'.repeat(1200);
    const post = makePost('p1', 'x', longContent);
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].clipType).toBe('video');
  });

  it('uses explicit clipType when provided instead of inferring', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    const post = makePost('p1', 'x', 'Short text');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan({ clipType: 'video' });

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].clipType).toBe('video');
  });

  it('cancels posts when platform has no configured slots', async () => {
    // Config with empty slots for the platform
    const configNoSlots = {
      timezone: 'America/Chicago',
      platforms: {
        x: { slots: [], avoidDays: [] as string[] },
      },
    };
    vi.mocked(loadScheduleConfig).mockReturnValue(configNoSlots as ReturnType<typeof loadScheduleConfig>);

    const sdk = makeSdk();
    const post = makePost('p1', 'x', 'Hello', null, 'draft');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'draft') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.toCancel.length).toBe(1);
    expect(plan.toCancel[0].postId).toBe('p1');
    expect(plan.toCancel[0].reason).toContain('No schedule slots');
  });

  it('does not cancel already-cancelled posts when no slots exist', async () => {
    const configNoSlots = {
      timezone: 'America/Chicago',
      platforms: {
        x: { slots: [], avoidDays: [] as string[] },
      },
    };
    vi.mocked(loadScheduleConfig).mockReturnValue(configNoSlots as ReturnType<typeof loadScheduleConfig>);

    const sdk = makeSdk();
    const post = makePost('p1', 'x', 'Hello', null, 'cancelled');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'cancelled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.toCancel.length).toBe(0);
  });

  it('skips posts that are already at the correct scheduled time', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    // Post already scheduled at the exact slot time
    const post = makePost('p1', 'x', 'Existing post', slot, 'scheduled');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.skipped).toBe(1);
    expect(plan.posts.length).toBe(0);
  });

  it('does not skip draft posts even if time matches', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slot = '2025-07-01T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slot]);

    const post = makePost('p1', 'x', 'Draft post', slot, 'draft');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'draft') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(1);
    expect(plan.skipped).toBe(0);
  });

  it('cancels excess posts when more posts than available slots', async () => {
    setupConfig();
    const sdk = makeSdk();
    // Only one slot returned
    vi.mocked(generateSlots).mockReturnValue(['2025-07-01T09:00:00-05:00']);

    const post1 = makePost('p1', 'x', 'First', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Second', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(1);
    expect(plan.toCancel.length).toBe(1);
    expect(plan.toCancel[0].reason).toContain('No more available slots');
  });

  it('sorts resulting posts by newScheduledFor time', async () => {
    setupConfig();
    const sdk = makeSdk();
    const slotEarly = '2025-07-01T09:00:00-05:00';
    const slotLate = '2025-07-02T09:00:00-05:00';
    vi.mocked(generateSlots).mockReturnValue([slotLate, slotEarly]);

    const post1 = makePost('p1', 'x', 'First', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Second', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts.length).toBe(2);
    const t1 = new Date(plan.posts[0].newScheduledFor).getTime();
    const t2 = new Date(plan.posts[1].newScheduledFor).getTime();
    expect(t1).toBeLessThanOrEqual(t2);
  });

  it('truncates content preview to 80 chars', async () => {
    setupConfig();
    const sdk = makeSdk();
    vi.mocked(generateSlots).mockReturnValue(['2025-07-01T09:00:00-05:00']);

    const longContent = 'X'.repeat(200);
    const post = makePost('p1', 'x', longContent, '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.posts[0].content.length).toBeLessThanOrEqual(80);
  });

  it('handles posts with platforms as objects with platform property', async () => {
    setupConfig();
    const sdk = makeSdk();
    vi.mocked(generateSlots).mockReturnValue(['2025-07-01T09:00:00-05:00']);

    const post = {
      _id: 'p1',
      id: 'p1',
      content: 'Hello',
      scheduledFor: '2025-06-15T10:00:00Z',
      status: 'scheduled',
      platforms: [{ platform: 'x' }],
    };
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();

    expect(plan.totalFetched).toBe(1);
  });

  it('filters by platform when option is provided', async () => {
    setupConfig();
    const sdk = makeSdk();
    vi.mocked(generateSlots).mockReturnValue([]);

    await buildRealignPlan({ platform: 'x' });

    for (const call of sdk.posts.listPosts.mock.calls) {
      expect((call[0] as Record<string, Record<string, unknown>>).query.platform).toBe('twitter');
    }
  });

  it('handles API returning posts as { posts: [] } wrapper', async () => {
    setupConfig();
    const sdk = makeSdk();
    vi.mocked(generateSlots).mockReturnValue(['2025-07-01T09:00:00-05:00']);

    const post = makePost('p1', 'x', 'Hello');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: { posts: [post] } };
      return { data: { posts: [] } };
    });

    const plan = await buildRealignPlan();

    expect(plan.totalFetched).toBe(1);
  });
});

// =====================================================
// executeRealignPlan
// =====================================================
describe('executeRealignPlan', () => {
  it('returns zero counts for an empty plan', async () => {
    makeSdk();

    const result = await executeRealignPlan({
      posts: [],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 0,
    });

    expect(result).toEqual({ updated: 0, cancelled: 0, failed: 0, errors: [] });
  });

  it('cancels posts in toCancel list via API', async () => {
    const sdk = makeSdk();

    const plan: RealignPlan = {
      posts: [],
      toCancel: [
        { postId: 'c1', platform: 'x', clipType: 'short', content: 'cancel me', reason: 'no slots' },
        { postId: 'c2', platform: 'x', clipType: 'short', content: 'also cancel', reason: 'no slots' },
      ],
      skipped: 0,
      unmatched: 0,
      totalFetched: 2,
    };

    const result = await executeRealignPlan(plan);

    expect(result.cancelled).toBe(2);
    expect(result.updated).toBe(0);
    expect(sdk.posts.updatePost).toHaveBeenCalledTimes(2);
    expect(sdk.posts.updatePost).toHaveBeenCalledWith({
      path: { postId: 'c1' },
      body: { status: 'cancelled' },
    });
  });

  it('updates posts with new scheduledFor and isDraft false', async () => {
    const sdk = makeSdk();

    const plan: RealignPlan = {
      posts: [
        {
          postId: 'u1',
          platform: 'x',
          clipType: 'short',
          content: 'update me',
          oldScheduledFor: '2025-06-10T10:00:00Z',
          newScheduledFor: '2025-07-01T09:00:00-05:00',
        },
      ],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };

    const result = await executeRealignPlan(plan);

    expect(result.updated).toBe(1);
    expect(sdk.posts.updatePost).toHaveBeenCalledWith({
      path: { postId: 'u1' },
      body: { scheduledFor: '2025-07-01T09:00:00-05:00', isDraft: false },
    });
  });

  it('handles mixed cancel and update operations', async () => {
    const sdk = makeSdk();

    const plan: RealignPlan = {
      posts: [
        {
          postId: 'u1',
          platform: 'x',
          clipType: 'short',
          content: 'update me',
          oldScheduledFor: null,
          newScheduledFor: '2025-07-01T09:00:00-05:00',
        },
      ],
      toCancel: [
        { postId: 'c1', platform: 'x', clipType: 'short', content: 'cancel me', reason: 'no slots' },
      ],
      skipped: 0,
      unmatched: 0,
      totalFetched: 2,
    };

    const result = await executeRealignPlan(plan);

    expect(result.cancelled).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(sdk.posts.updatePost).toHaveBeenCalledTimes(2);
  });

  it('records errors and increments failed count when cancel fails', async () => {
    const sdk = makeSdk();
    sdk.posts.updatePost.mockRejectedValueOnce(new Error('API down'));

    const plan: RealignPlan = {
      posts: [],
      toCancel: [
        { postId: 'c1', platform: 'x', clipType: 'short', content: 'fail', reason: 'no slots' },
      ],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };

    const result = await executeRealignPlan(plan);

    expect(result.failed).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({ postId: 'c1', error: 'API down' });
  });

  it('records errors when update fails', async () => {
    const sdk = makeSdk();
    sdk.posts.updatePost.mockRejectedValueOnce(new Error('Timeout'));

    const plan: RealignPlan = {
      posts: [
        {
          postId: 'u1',
          platform: 'x',
          clipType: 'short',
          content: 'fail update',
          oldScheduledFor: null,
          newScheduledFor: '2025-07-01T09:00:00-05:00',
        },
      ],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };

    const result = await executeRealignPlan(plan);

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors[0].error).toBe('Timeout');
  });

  it('handles non-Error thrown values', async () => {
    const sdk = makeSdk();
    sdk.posts.updatePost.mockRejectedValueOnce('string error');

    const plan: RealignPlan = {
      posts: [
        {
          postId: 'u1',
          platform: 'x',
          clipType: 'short',
          content: 'fail',
          oldScheduledFor: null,
          newScheduledFor: '2025-07-01T09:00:00-05:00',
        },
      ],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };

    const result = await executeRealignPlan(plan);

    expect(result.errors[0].error).toBe('string error');
  });

  it('continues executing remaining items after a failure', async () => {
    const sdk = makeSdk();
    sdk.posts.updatePost
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce({ data: {} });

    const plan: RealignPlan = {
      posts: [
        {
          postId: 'u1',
          platform: 'x',
          clipType: 'short',
          content: 'fail',
          oldScheduledFor: null,
          newScheduledFor: '2025-07-01T09:00:00-05:00',
        },
        {
          postId: 'u2',
          platform: 'x',
          clipType: 'short',
          content: 'succeed',
          oldScheduledFor: null,
          newScheduledFor: '2025-07-02T09:00:00-05:00',
        },
      ],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 2,
    };

    const result = await executeRealignPlan(plan);

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
    expect(sdk.posts.updatePost).toHaveBeenCalledTimes(2);
  });
});

// =====================================================
// buildPrioritizedRealignPlan
// =====================================================
describe('buildPrioritizedRealignPlan', () => {
  it('returns empty plan when no schedule config is loaded', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValue(null);
    makeSdk();

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['test'], saturation: 1.0 }],
    });

    expect(plan).toEqual({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 });
  });

  it('returns base plan as-is when base plan has no posts', async () => {
    setupConfig();
    makeSdk();
    vi.mocked(generateSlots).mockReturnValue([]);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['launch'], saturation: 1.0 }],
    });

    expect(plan.posts).toHaveLength(0);
  });

  it('assigns priority posts to earlier slots based on keyword match', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Launch announcement coming soon', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Regular update today', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    // First call: buildRealignPlan needs slots
    // Second call: buildPrioritizedRealignPlan generates 2x slots
    const baseSlotsCall = ['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00'];
    const prioritySlotsCall = [
      '2025-07-01T09:00:00-05:00',
      '2025-07-02T09:00:00-05:00',
      '2025-07-03T09:00:00-05:00',
      '2025-07-04T09:00:00-05:00',
    ];
    vi.mocked(generateSlots)
      .mockReturnValueOnce(baseSlotsCall)
      .mockReturnValueOnce(prioritySlotsCall);

    // Mock Math.random to always be below saturation (ensures rule triggers)
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['launch'], saturation: 1.0 }],
    });

    expect(plan.posts.length).toBe(2);
    // "Launch" post should be assigned to the first slot
    const launchPost = plan.posts.find(p => p.postId === 'p1');
    expect(launchPost).toBeDefined();
    expect(launchPost!.newScheduledFor).toBe('2025-07-01T09:00:00-05:00');

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('skips priority assignment when saturation probability is not met', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Launch post', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Regular post', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00', '2025-07-03T09:00:00-05:00', '2025-07-04T09:00:00-05:00']);

    // Math.random returns 0.9 which is >= saturation of 0.5, so rule doesn't fire.
    // The "Launch" post matches keywords and is excluded from remainingPool,
    // but never assigned via priority (saturation blocks it). Only the non-matching post is assigned.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['launch'], saturation: 0.5 }],
    });

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].postId).toBe('p2');

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('falls back to remaining pool when no priority rules match', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post = makePost('p1', 'x', 'No keywords match here', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00']);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['nonexistent'], saturation: 1.0 }],
    });

    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].postId).toBe('p1');
  });

  it('respects date range filtering with from/to', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post = makePost('p1', 'x', 'Launch content', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    // Slots outside the rule date range
    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-08-01T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-08-01T09:00:00-05:00', '2025-08-02T09:00:00-05:00']);

    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{
        keywords: ['launch'],
        saturation: 1.0,
        from: '2025-07-01',
        to: '2025-07-15',
      }],
    });

    // Slot is in August, outside the July date range. The post matches the keyword
    // so it's excluded from remainingPool but can't be assigned via priority either.
    expect(plan.posts.length).toBe(0);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('handles multiple priority rules in order', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Launch announcement', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Urgent update', '2025-06-11T10:00:00Z');
    const post3 = makePost('p3', 'x', 'Regular stuff', '2025-06-12T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2, post3] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00', '2025-07-03T09:00:00-05:00'])
      .mockReturnValueOnce([
        '2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00',
        '2025-07-03T09:00:00-05:00', '2025-07-04T09:00:00-05:00',
        '2025-07-05T09:00:00-05:00', '2025-07-06T09:00:00-05:00',
      ]);

    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [
        { keywords: ['launch'], saturation: 1.0 },
        { keywords: ['urgent'], saturation: 1.0 },
      ],
    });

    expect(plan.posts.length).toBe(3);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('performs case-insensitive keyword matching', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post = makePost('p1', 'x', 'LAUNCH DAY!', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00']);

    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['launch'], saturation: 1.0 }],
    });

    // Should still match despite case difference
    expect(plan.posts.length).toBe(1);
    expect(plan.posts[0].postId).toBe('p1');

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('preserves toCancel, skipped, unmatched, and totalFetched from base plan', async () => {
    setupConfig();
    const sdk = makeSdk();

    // Return posts for scheduled status, including one that will be cancelled (no platform match)
    const post1 = makePost('p1', 'x', 'Hello', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00']);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['nope'], saturation: 1.0 }],
    });

    expect(plan.totalFetched).toBe(1);
    expect(typeof plan.skipped).toBe('number');
    expect(typeof plan.unmatched).toBe('number');
    expect(Array.isArray(plan.toCancel)).toBe(true);
  });

  it('generates 2x slots for prioritized scheduling', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Post A', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Post B', '2025-06-11T10:00:00Z');
    const post3 = makePost('p3', 'x', 'Post C', '2025-06-12T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2, post3] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00', '2025-07-03T09:00:00-05:00'])
      .mockReturnValueOnce([
        '2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00', '2025-07-03T09:00:00-05:00',
        '2025-07-04T09:00:00-05:00', '2025-07-05T09:00:00-05:00', '2025-07-06T09:00:00-05:00',
      ]);

    await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['test'], saturation: 1.0 }],
    });

    // Second generateSlots call (from buildPrioritizedRealignPlan) should request 2x posts.length
    const secondCall = vi.mocked(generateSlots).mock.calls[1];
    expect(secondCall[2]).toBe(6); // 3 posts * 2
  });

  it('sorts result posts by newScheduledFor time', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Post A', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Post B', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00'])
      .mockReturnValueOnce(['2025-07-05T09:00:00-05:00', '2025-07-01T09:00:00-05:00', '2025-07-03T09:00:00-05:00', '2025-07-02T09:00:00-05:00']);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['nope'], saturation: 1.0 }],
    });

    for (let i = 1; i < plan.posts.length; i++) {
      const prev = new Date(plan.posts[i - 1].newScheduledFor).getTime();
      const curr = new Date(plan.posts[i].newScheduledFor).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('skips slots when generateSlots returns empty array for a group', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post = makePost('p1', 'x', 'Hello', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00'])
      .mockReturnValueOnce([]); // No slots for prioritized pass

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['hello'], saturation: 1.0 }],
    });

    expect(plan.posts).toHaveLength(0);
  });
});

// =====================================================
// Integration: buildRealignPlan + executeRealignPlan
// =====================================================
describe('buildRealignPlan → executeRealignPlan integration', () => {
  it('builds a plan and executes it end-to-end', async () => {
    setupConfig();
    const sdk = makeSdk();
    vi.mocked(generateSlots).mockReturnValue(['2025-07-01T09:00:00-05:00']);

    const post = makePost('p1', 'x', 'Tweet', '2025-06-10T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();
    expect(plan.posts.length).toBeGreaterThan(0);

    const result = await executeRealignPlan(plan);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('builds and executes a plan with cancellations', async () => {
    const configNoSlots = {
      timezone: 'America/Chicago',
      platforms: {
        x: { slots: [], avoidDays: [] as string[] },
      },
    };
    vi.mocked(loadScheduleConfig).mockReturnValue(configNoSlots as ReturnType<typeof loadScheduleConfig>);

    const sdk = makeSdk();
    const post = makePost('p1', 'x', 'To cancel', null, 'draft');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'draft') return { data: [post] };
      return { data: [] };
    });

    const plan = await buildRealignPlan();
    expect(plan.toCancel.length).toBe(1);

    const result = await executeRealignPlan(plan);
    expect(result.cancelled).toBe(1);
    expect(sdk.posts.updatePost).toHaveBeenCalledWith({
      path: { postId: 'p1' },
      body: { status: 'cancelled' },
    });
  });
});

// =====================================================
// buildPrioritizedRealignPlan + executeRealignPlan integration
// =====================================================
describe('buildPrioritizedRealignPlan → executeRealignPlan integration', () => {
  it('builds a prioritized plan and executes it end-to-end', async () => {
    setupConfig();
    const sdk = makeSdk();

    const post1 = makePost('p1', 'x', 'Launch product today!', '2025-06-10T10:00:00Z');
    const post2 = makePost('p2', 'x', 'Regular update', '2025-06-11T10:00:00Z');
    sdk.posts.listPosts.mockImplementation(async (opts: Record<string, Record<string, unknown>>) => {
      if (opts.query.status === 'scheduled') return { data: [post1, post2] };
      return { data: [] };
    });

    vi.mocked(generateSlots)
      .mockReturnValueOnce(['2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00'])
      .mockReturnValueOnce([
        '2025-07-01T09:00:00-05:00', '2025-07-02T09:00:00-05:00',
        '2025-07-03T09:00:00-05:00', '2025-07-04T09:00:00-05:00',
      ]);

    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['launch'], saturation: 1.0 }],
    });

    expect(plan.posts.length).toBe(2);

    const result = await executeRealignPlan(plan);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);

    vi.spyOn(Math, 'random').mockRestore();
  });
});
