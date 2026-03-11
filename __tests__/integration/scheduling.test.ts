import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

let mockClient: MockLateApiClient;

vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

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

import { server } from '../../src/mcpServer.js';
import { loadScheduleConfig } from '../../src/config/scheduleConfig.js';

await import('../../src/tools/scheduling.js');

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function getToolHandler(toolName: string): ToolHandler {
  const handler = toolHandlers.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not registered`);
  return handler;
}

beforeEach(() => {
  mockClient = createMockClient();
});

// ── Registration ──

describe('scheduling tools registration', () => {
  it('registers all four scheduling tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('schedule_post');
    expect(names).toContain('find_next_slot');
    expect(names).toContain('view_calendar');
    expect(names).toContain('view_schedule_config');
  });
});

// ── schedule_post ──

describe('schedule_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedules a post with a valid ISO datetime', async () => {
    mockClient.updatePost.mockResolvedValue({ _id: 'p1' });

    const handler = getToolHandler('schedule_post');
    const result = await handler({ postId: 'p1', scheduledFor: '2025-06-15T09:00:00Z' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('p1');
    expect(result.content[0].text).toContain('2025-06-15T09:00:00Z');
    expect(result.content[0].text).toContain('✅');
  });

  it('calls updatePost with correct postId and body', async () => {
    mockClient.updatePost.mockResolvedValue({});

    const handler = getToolHandler('schedule_post');
    await handler({ postId: 'abc123', scheduledFor: '2025-07-01T14:00:00Z' });

    expect(mockClient.updatePost).toHaveBeenCalledWith('abc123', {
      scheduledFor: '2025-07-01T14:00:00Z',
    });
  });

  it('returns error when client throws', async () => {
    mockClient.updatePost.mockRejectedValue(new Error('Post not found'));

    const handler = getToolHandler('schedule_post');
    const result = await handler({ postId: 'bad-id', scheduledFor: '2025-06-15T09:00:00Z' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Post not found');
  });

  it('handles non-Error exceptions gracefully', async () => {
    mockClient.updatePost.mockRejectedValue('unexpected string error');

    const handler = getToolHandler('schedule_post');
    const result = await handler({ postId: 'p1', scheduledFor: '2025-06-15T09:00:00Z' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to schedule post');
  });
});

// ── find_next_slot ──

describe('find_next_slot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds the next available slot for a platform', async () => {
    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Next available slot');
    expect(result.content[0].text).toContain('America/Chicago');
  });

  it('returns error when no config is found', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);

    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No schedule config found');
  });

  it('returns error when platform has no slots', async () => {
    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'linkedin' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No schedule slots configured');
  });

  it('skips booked slots and finds the next open one', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const scheduledPost = {
      scheduledFor: tomorrow.toISOString(),
      content: 'Already booked post',
    };
    mockClient.listPosts.mockResolvedValue({ data: [scheduledPost] });

    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Next available slot');
  });

  it('shows nearby posts scheduled on the same day', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    futureDate.setHours(14, 0, 0, 0);

    const nearbyPost = {
      scheduledFor: futureDate.toISOString(),
      content: 'A post on the same day',
    };
    mockClient.listPosts.mockResolvedValue({ data: [nearbyPost] });

    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Next available slot');
  });

  it('returns ISO datetime in the response', async () => {
    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('ISO:');
  });

  it('handles API error when fetching posts', async () => {
    mockClient.listPosts.mockRejectedValue(new Error('Network timeout'));

    const handler = getToolHandler('find_next_slot');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Network timeout');
  });
});

// ── view_calendar ──

describe('view_calendar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows scheduled posts grouped by date', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    futureDate.setHours(10, 0, 0, 0);

    const posts = [
      {
        scheduledFor: futureDate.toISOString(),
        content: 'Morning post',
        platforms: ['twitter'],
      },
    ];
    mockClient.listPosts.mockResolvedValue({ data: posts });

    const handler = getToolHandler('view_calendar');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Scheduled Posts');
    expect(result.content[0].text).toContain('America/Chicago');
  });

  it('shows empty message when no posts are scheduled', async () => {
    const handler = getToolHandler('view_calendar');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No scheduled posts');
  });

  it('respects the days parameter for look-ahead', async () => {
    const handler = getToolHandler('view_calendar');
    const result = await handler({ days: 14 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('14');
  });

  it('filters out posts beyond the look-ahead window', async () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);

    const posts = [
      {
        scheduledFor: farFuture.toISOString(),
        content: 'Far future post',
        platforms: ['instagram'],
      },
    ];
    mockClient.listPosts.mockResolvedValue({ data: posts });

    const handler = getToolHandler('view_calendar');
    const result = await handler({ days: 7 });

    expect(result.content[0].text).toContain('No scheduled posts');
  });

  it('returns error on API failure', async () => {
    mockClient.listPosts.mockRejectedValue(new Error('Auth expired'));

    const handler = getToolHandler('view_calendar');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Auth expired');
  });
});

// ── view_schedule_config ──

describe('view_schedule_config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows full schedule config for all platforms', async () => {
    const handler = getToolHandler('view_schedule_config');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Schedule Config');
    expect(result.content[0].text).toContain('America/Chicago');
    expect(result.content[0].text).toContain('09:00');
    expect(result.content[0].text).toContain('Morning');
  });

  it('filters by platform when specified', async () => {
    const handler = getToolHandler('view_schedule_config');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('09:00');
    expect(result.content[0].text).toContain('14:00');
  });

  it('returns error when no config exists', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);

    const handler = getToolHandler('view_schedule_config');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No schedule config found');
  });

  it('returns error for unknown platform', async () => {
    const handler = getToolHandler('view_schedule_config');
    const result = await handler({ platform: 'snapchat' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found in schedule config');
  });

  it('shows avoidDays in the output', async () => {
    const handler = getToolHandler('view_schedule_config');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('sat');
    expect(result.content[0].text).toContain('sun');
  });

  it('shows byClipType slots when present', async () => {
    const handler = getToolHandler('view_schedule_config');
    const result = await handler({ platform: 'x' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('short');
  });
});
