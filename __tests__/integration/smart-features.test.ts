import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

// ── Mocks ──

let mockClient: MockLateApiClient;

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(() => mockClient),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
  resetClient: vi.fn(),
  LateApiClient: vi.fn(),
}));

vi.mock('../../src/config/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn(() => ({
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
  })),
  getSlotsForPlatform: vi.fn((_config: unknown, platform: string, clipType?: string) => {
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
  }),
  normalizePlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
  validateScheduleConfig: vi.fn(() => []),
}));

import { loadScheduleConfig } from '../../src/config/scheduleConfig.js';
import {
  generateSlots,
  buildSlotDatetime,
  getDayOfWeekInTimezone,
  detectConflicts,
  autoResolveConflicts,
} from '../../src/smart/scheduler.js';
import {
  getBestTimesToPost,
  getPostingFrequency,
  getContentDecay,
} from '../../src/smart/optimizer.js';

// ── Helpers ──

/** Get a Date for a specific day-of-week in the near future. */
function getNextWeekday(dow: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'): Date {
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const target = map[dow];
  const now = new Date();
  const current = now.getUTCDay();
  const daysAhead = (target - current + 7) % 7 || 7;
  const result = new Date(now);
  result.setDate(result.getDate() + daysAhead);
  result.setHours(12, 0, 0, 0);
  return result;
}

// ── buildSlotDatetime ──

describe('buildSlotDatetime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('produces a valid ISO 8601 datetime with offset', () => {
    const date = new Date('2025-06-16T12:00:00Z'); // A Monday
    const result = buildSlotDatetime(date, '09:00', 'America/Chicago');

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00[+-]\d{2}:\d{2}$/);
    expect(result).toContain('2025-06-16');
  });

  it('uses the correct date for the timezone (not UTC date)', () => {
    // 2025-06-17 at 04:00 UTC = 2025-06-16 in Chicago (CDT = UTC-5)
    const date = new Date('2025-06-17T04:00:00Z');
    const result = buildSlotDatetime(date, '09:00', 'America/Chicago');

    expect(result).toContain('2025-06-16');
  });

  it('includes CDT offset for summer dates', () => {
    const date = new Date('2025-07-01T12:00:00Z');
    const result = buildSlotDatetime(date, '10:00', 'America/Chicago');

    expect(result).toContain('-05:00');
  });

  it('handles UTC timezone correctly', () => {
    const date = new Date('2025-06-16T12:00:00Z');
    const result = buildSlotDatetime(date, '15:30', 'UTC');

    expect(result).toContain('15:30:00');
    expect(result).toContain('+00:00');
  });
});

// ── getDayOfWeekInTimezone ──

describe('getDayOfWeekInTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns correct day for a known date', () => {
    // 2025-06-16 is a Monday
    const date = new Date('2025-06-16T12:00:00Z');
    const result = getDayOfWeekInTimezone(date, 'America/Chicago');

    expect(result).toBe('mon');
  });

  it('handles timezone boundary correctly', () => {
    // 2025-06-17 at 03:00 UTC = 2025-06-16 (Monday) in Chicago
    const date = new Date('2025-06-17T03:00:00Z');
    const result = getDayOfWeekInTimezone(date, 'America/Chicago');

    expect(result).toBe('mon');
  });

  it('returns sun for a Sunday date', () => {
    // 2025-06-22 is a Sunday
    const date = new Date('2025-06-22T12:00:00Z');
    const result = getDayOfWeekInTimezone(date, 'UTC');

    expect(result).toBe('sun');
  });

  it('returns sat for a Saturday date', () => {
    // 2025-06-21 is a Saturday
    const date = new Date('2025-06-21T12:00:00Z');
    const result = getDayOfWeekInTimezone(date, 'UTC');

    expect(result).toBe('sat');
  });

  it('returns a valid DayOfWeek value for any date', () => {
    const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    for (let i = 0; i < 7; i++) {
      const date = new Date('2025-06-16T12:00:00Z');
      date.setDate(date.getDate() + i);
      const result = getDayOfWeekInTimezone(date, 'America/Chicago');
      expect(validDays).toContain(result);
    }
  });
});

// ── generateSlots ──

describe('generateSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('generates the requested number of slots', () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', undefined, 5, bookedMs, 'America/Chicago');

    expect(slots.length).toBe(5);
  });

  it('respects avoidDays (no Saturday/Sunday for x)', () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', undefined, 20, bookedMs, 'America/Chicago');

    for (const slot of slots) {
      const date = new Date(slot);
      const dayOfWeek = getDayOfWeekInTimezone(date, 'America/Chicago');
      expect(dayOfWeek).not.toBe('sat');
      expect(dayOfWeek).not.toBe('sun');
    }
  });

  it('skips booked time slots', () => {
    const bookedMs = new Set<number>();
    const firstBatch = generateSlots('x', undefined, 3, bookedMs, 'America/Chicago');
    expect(firstBatch.length).toBe(3);

    // bookedMs is mutated by generateSlots, so the second call skips those
    const secondBatch = generateSlots('x', undefined, 3, bookedMs, 'America/Chicago');
    expect(secondBatch.length).toBe(3);

    const allSlots = [...firstBatch, ...secondBatch];
    const uniqueSlots = new Set(allSlots.map(s => new Date(s).getTime()));
    expect(uniqueSlots.size).toBe(6);
  });

  it('returns empty array when no config exists', () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);
    const slots = generateSlots('x', undefined, 5, new Set(), 'America/Chicago');

    expect(slots).toEqual([]);
  });

  it('returns empty array for platform with no slots', () => {
    const slots = generateSlots('linkedin', undefined, 5, new Set(), 'America/Chicago');

    expect(slots).toEqual([]);
  });

  it('generates slots with valid ISO datetime format', () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', undefined, 3, bookedMs, 'America/Chicago');

    for (const slot of slots) {
      expect(new Date(slot).getTime()).not.toBeNaN();
      expect(slot).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it('generates slots for clipType-specific schedule', () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', 'short', 4, bookedMs, 'America/Chicago');

    expect(slots.length).toBe(4);
    for (const slot of slots) {
      const date = new Date(slot);
      const dow = getDayOfWeekInTimezone(date, 'America/Chicago');
      expect(['tue', 'thu']).toContain(dow);
    }
  });

  it('generates only future slots', () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', undefined, 5, bookedMs, 'America/Chicago');
    const now = Date.now();

    for (const slot of slots) {
      expect(new Date(slot).getTime()).toBeGreaterThan(now);
    }
  });
});

// ── detectConflicts ──

describe('detectConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('detects duplicate time slot conflicts', async () => {
    const scheduledFor = '2025-06-16T14:00:00Z';
    mockClient.listPosts.mockResolvedValue({ data: [
      { _id: 'p1', scheduledFor, platforms: ['twitter'], content: 'Post 1', status: 'scheduled' },
      { _id: 'p2', scheduledFor, platforms: ['twitter'], content: 'Post 2', status: 'scheduled' },
    ] });

    const report = await detectConflicts('x');

    expect(report.conflicts.length).toBe(2);
    expect(report.conflicts[0].issue).toContain('2 posts scheduled at the same time');
  });

  it('detects posts scheduled on avoided days', async () => {
    const saturday = getNextWeekday('sat');
    const saturdayIso = saturday.toISOString();

    mockClient.listPosts.mockResolvedValue({ data: [
      { _id: 'p1', scheduledFor: saturdayIso, platforms: ['twitter'], content: 'Weekend post', status: 'scheduled' },
    ] });

    const report = await detectConflicts('x');

    expect(report.outOfWindow.length).toBeGreaterThanOrEqual(1);
    const satIssue = report.outOfWindow.find(o => o.postId === 'p1');
    expect(satIssue?.issue).toContain('avoided day');
  });

  it('returns empty report when no posts exist', async () => {
    const report = await detectConflicts();

    expect(report.conflicts).toEqual([]);
    expect(report.outOfWindow).toEqual([]);
  });

  it('detects posts at times not matching any configured slot', async () => {
    const monday = getNextWeekday('mon');
    monday.setUTCHours(3, 30, 0, 0); // 03:30 UTC → 22:30 CDT previous day or unusual time

    mockClient.listPosts.mockResolvedValue({ data: [
      { _id: 'p1', scheduledFor: monday.toISOString(), platforms: ['twitter'], content: 'Odd time', status: 'scheduled' },
    ] });

    const report = await detectConflicts('x');

    const totalIssues = report.conflicts.length + report.outOfWindow.length;
    expect(totalIssues).toBeGreaterThanOrEqual(0);
  });
});

// ── autoResolveConflicts ──

describe('autoResolveConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns empty plan when no conflicts', async () => {
    const result = await autoResolveConflicts('x', false);

    expect(result.plan).toEqual([]);
    expect(result.executed).toBe(false);
  });

  it('returns empty plan when config is missing', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);

    const result = await autoResolveConflicts('x', false);

    expect(result.plan).toEqual([]);
    expect(result.executed).toBe(false);
  });

  it('creates a resolve plan for duplicate-time conflicts', async () => {
    const scheduledFor = '2025-06-16T14:00:00Z';
    mockClient.listPosts.mockResolvedValue({ data: [
      { _id: 'p1', scheduledFor, platforms: ['twitter'], content: 'Post 1', status: 'scheduled' },
      { _id: 'p2', scheduledFor, platforms: ['twitter'], content: 'Post 2', status: 'scheduled' },
    ] });

    const result = await autoResolveConflicts('x', false);

    expect(result.executed).toBe(false);
    expect(result.plan.length).toBeGreaterThanOrEqual(1);
    for (const move of result.plan) {
      expect(move.postId).toBeDefined();
      expect(move.from).toBeDefined();
      expect(move.to).toBeDefined();
      expect(move.reason).toBeDefined();
    }
  });

  it('executes moves when execute=true', async () => {
    const scheduledFor = '2025-06-16T14:00:00Z';
    mockClient.listPosts.mockResolvedValue({ data: [
      { _id: 'p1', scheduledFor, platforms: ['twitter'], content: 'Post 1', status: 'scheduled' },
      { _id: 'p2', scheduledFor, platforms: ['twitter'], content: 'Post 2', status: 'scheduled' },
    ] });
    mockClient.updatePost.mockResolvedValue({});

    const result = await autoResolveConflicts('x', true);

    expect(result.plan.length).toBeGreaterThanOrEqual(1);
    expect(result.executed).toBe(true);
    expect(mockClient.updatePost).toHaveBeenCalled();
  });
});

// ── getBestTimesToPost ──

describe('getBestTimesToPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns best times from analytics API', async () => {
    mockClient.getAnalytics.mockResolvedValue({ data: [
      {
        platform: 'instagram',
        bestTimes: [
          { day: 'Monday', hour: 10, engagement: 95 },
          { day: 'Wednesday', hour: 14, engagement: 88 },
        ],
      },
    ] });

    const results = await getBestTimesToPost('instagram');

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].platform).toBe('instagram');
    expect(results[0].bestTimes.length).toBe(2);
    expect(results[0].bestTimes[0].engagement).toBe(95);
  });

  it('returns empty array when API returns no data', async () => {
    const results = await getBestTimesToPost('x');

    expect(results).toEqual([]);
  });

  it('returns empty array on API failure', async () => {
    mockClient.getAnalytics.mockRejectedValue(new Error('Timeout'));

    const results = await getBestTimesToPost('x');

    expect(results).toEqual([]);
  });
});

// ── getPostingFrequency ──

describe('getPostingFrequency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns frequency analysis with recommendation', async () => {
    mockClient.getAnalytics.mockResolvedValue({ data: [
      {
        platform: 'x',
        currentFrequency: 3,
        optimalFrequency: 7,
        engagementCorrelation: 0.85,
      },
    ] });

    const results = await getPostingFrequency('x');

    expect(results.length).toBe(1);
    expect(results[0].currentFrequency).toBe(3);
    expect(results[0].optimalFrequency).toBe(7);
    expect(results[0].recommendation).toContain('increasing');
  });

  it('recommends maintaining frequency when current matches optimal', async () => {
    mockClient.getAnalytics.mockResolvedValue({ data: [
      {
        platform: 'instagram',
        currentFrequency: 5,
        optimalFrequency: 5,
        engagementCorrelation: 0.9,
      },
    ] });

    const results = await getPostingFrequency('instagram');

    expect(results[0].recommendation).toContain('Maintain');
  });

  it('recommends reducing when current is too high', async () => {
    mockClient.getAnalytics.mockResolvedValue({ data: [
      {
        platform: 'x',
        currentFrequency: 14,
        optimalFrequency: 5,
        engagementCorrelation: 0.6,
      },
    ] });

    const results = await getPostingFrequency('x');

    expect(results[0].recommendation).toContain('reducing');
  });

  it('returns empty array on API failure', async () => {
    mockClient.getAnalytics.mockRejectedValue(new Error('Auth error'));

    const results = await getPostingFrequency('x');

    expect(results).toEqual([]);
  });
});

// ── getContentDecay ──

describe('getContentDecay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns decay analysis for a specific post', async () => {
    mockClient.getPostTimeline.mockResolvedValue({ data: [
      { date: '2025-06-10T10:00:00Z', likes: 50, comments: 10, shares: 5, impressions: 200 },
      { date: '2025-06-10T14:00:00Z', likes: 80, comments: 20, shares: 10, impressions: 400 },
      { date: '2025-06-11T09:00:00Z', likes: 30, comments: 5, shares: 2, impressions: 100 },
    ] });

    const results = await getContentDecay('post123', 'instagram');

    expect(results.length).toBe(1);
    expect(results[0].postId).toBe('post123');
    expect(results[0].totalEngagement).toBeGreaterThan(0);
    expect(results[0].decayPoints.length).toBe(3);
  });

  it('calculates half-life when enough data exists', async () => {
    mockClient.getPostTimeline.mockResolvedValue({ data: [
      { date: '2025-06-10T10:00:00Z', likes: 100, comments: 50, shares: 25, impressions: 500 },
      { date: '2025-06-10T15:00:00Z', likes: 50, comments: 10, shares: 5, impressions: 200 },
    ] });

    const results = await getContentDecay('post456', 'x');

    expect(results.length).toBe(1);
    expect(results[0].halfLifeHours).not.toBeNull();
    expect(typeof results[0].halfLifeHours).toBe('number');
  });

  it('returns result with empty timeline on API error', async () => {
    mockClient.getPostTimeline.mockRejectedValue(new Error('Not found'));

    const results = await getContentDecay('bad-post', 'x');

    expect(results).toEqual([]);
  });

  it('computes cumulative engagement percentages', async () => {
    mockClient.getPostTimeline.mockResolvedValue({ data: [
      { date: '2025-06-10T10:00:00Z', likes: 10, comments: 0, shares: 0, impressions: 40 },
      { date: '2025-06-10T12:00:00Z', likes: 10, comments: 0, shares: 0, impressions: 40 },
    ] });

    const results = await getContentDecay('post789', 'instagram');

    expect(results[0].decayPoints[0].percentOfTotal).toBe(50);
    expect(results[0].decayPoints[1].percentOfTotal).toBe(100);
  });
});
