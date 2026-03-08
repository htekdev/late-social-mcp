import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(),
  unwrap: vi.fn((result: { data?: unknown; error?: unknown }) => {
    if (result.error) throw new Error(String(result.error));
    return result.data;
  }),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
}));

import { server } from '../../src/mcpServer.js';
import { getClient, unwrap } from '../../src/client/lateClient.js';

await import('../../src/tools/analytics.js');

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function getToolHandler(toolName: string): ToolHandler {
  const handler = toolHandlers.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not registered`);
  return handler;
}

function mockSdk(overrides: Record<string, unknown> = {}) {
  const sdk = {
    analytics: {
      getAnalytics: vi.fn().mockResolvedValue({ data: [] }),
      getDailyMetrics: vi.fn().mockResolvedValue({ data: [] }),
      getPostTimeline: vi.fn().mockResolvedValue({ data: [] }),
      getYouTubeDailyViews: vi.fn().mockResolvedValue({ data: [] }),
    },
    accounts: {
      getFollowerStats: vi.fn().mockResolvedValue({ data: [] }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

describe('analytics tools registration', () => {
  it('registers all five analytics tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('get_post_analytics');
    expect(names).toContain('get_daily_metrics');
    expect(names).toContain('get_follower_stats');
    expect(names).toContain('get_post_timeline');
    expect(names).toContain('get_youtube_daily_views');
  });
});

describe('get_post_analytics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted analytics data', async () => {
    const sdk = mockSdk();
    sdk.analytics.getAnalytics.mockResolvedValue({
      data: [{ postId: 'p1', platform: 'instagram', impressions: 5000, reach: 3000, likes: 200, comments: 15, shares: 30 }],
    });
    vi.mocked(unwrap).mockReturnValue([
      { postId: 'p1', platform: 'instagram', impressions: 5000, reach: 3000, likes: 200, comments: 15, shares: 30 },
    ]);

    const handler = getToolHandler('get_post_analytics');
    const result = await handler({ postId: 'p1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Analytics');
    expect(result.content[0].text).toContain('p1');
    expect(result.content[0].text).toContain('5000');
    expect(result.content[0].text).toContain('3000');
  });

  it('returns empty message when no data', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('get_post_analytics');
    const result = await handler({});

    expect(result.content[0].text).toContain('No analytics data found');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('API rate limit'); });

    const handler = getToolHandler('get_post_analytics');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API rate limit');
  });
});

describe('get_daily_metrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted daily metrics table', async () => {
    const sdk = mockSdk();
    sdk.analytics.getDailyMetrics.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
      { date: '2024-06-01', impressions: 1200, reach: 800, likes: 50, comments: 10, shares: 5 },
      { date: '2024-06-02', impressions: 1500, reach: 900, likes: 60, comments: 12, shares: 8 },
    ]);

    const handler = getToolHandler('get_daily_metrics');
    const result = await handler({ dateFrom: '2024-06-01', dateTo: '2024-06-02' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Daily Metrics');
    expect(result.content[0].text).toContain('2024-06-01');
    expect(result.content[0].text).toContain('1200');
    expect(result.content[0].text).toContain('Total days: 2');
  });

  it('handles comma-separated platforms', async () => {
    const sdk = mockSdk();
    sdk.analytics.getDailyMetrics.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('get_daily_metrics');
    await handler({ platforms: 'instagram,x' });

    expect(sdk.analytics.getDailyMetrics).toHaveBeenCalled();
  });
});

describe('get_follower_stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted follower stats', async () => {
    const sdk = mockSdk();
    sdk.accounts.getFollowerStats.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
      { accountId: 'a1', platform: 'instagram', followers: 10000, gained: 50, lost: 10, netChange: 40 },
    ]);

    const handler = getToolHandler('get_follower_stats');
    const result = await handler({ accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Follower Stats');
    expect(result.content[0].text).toContain('10000');
    expect(result.content[0].text).toContain('+50');
    expect(result.content[0].text).toContain('+40');
  });
});

describe('get_post_timeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted timeline data', async () => {
    const sdk = mockSdk();
    sdk.analytics.getPostTimeline.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
      { date: '2024-06-01T10:00', impressions: 100, likes: 5, comments: 2, shares: 1 },
      { date: '2024-06-01T12:00', impressions: 300, likes: 15, comments: 5, shares: 3 },
    ]);

    const handler = getToolHandler('get_post_timeline');
    const result = await handler({ postId: 'p1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Timeline');
    expect(result.content[0].text).toContain('p1');
    expect(result.content[0].text).toContain('Total data points: 2');
  });

  it('handles empty timeline', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('get_post_timeline');
    const result = await handler({ postId: 'p1' });

    expect(result.content[0].text).toContain('No timeline data found');
  });
});

describe('get_youtube_daily_views', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted YouTube views with totals', async () => {
    const sdk = mockSdk();
    sdk.analytics.getYouTubeDailyViews.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
      { date: '2024-06-01', views: 500 },
      { date: '2024-06-02', views: 750 },
    ]);

    const handler = getToolHandler('get_youtube_daily_views');
    const result = await handler({ videoId: 'vid123' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('YouTube Daily Views');
    expect(result.content[0].text).toContain('vid123');
    expect(result.content[0].text).toContain('Total views: 1250');
    expect(result.content[0].text).toContain('Days tracked: 2');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Not found'); });

    const handler = getToolHandler('get_youtube_daily_views');
    const result = await handler({ videoId: 'bad' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found');
  });
});
