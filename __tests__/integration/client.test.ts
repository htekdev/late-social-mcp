import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config so getLateApiKey returns a test key without touching the filesystem
vi.mock('../../src/config/config.js', () => ({
  getLateApiKey: vi.fn(() => 'test-api-key'),
}));

import {
  LateApiClient,
  getClient,
  resetClient,
  toApiPlatform,
  toDisplayPlatform,
} from '../../src/client/lateApi.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal fetch Response-like object */
function mockFetchResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: vi.fn().mockResolvedValue(body ?? null),
  } as unknown as Response;
}

// ─── Pure functions ─────────────────────────────────────────────────────────

describe('lateClient — pure functions', () => {
  describe('toApiPlatform', () => {
    it('maps "x" to "twitter"', () => {
      expect(toApiPlatform('x')).toBe('twitter');
    });

    it('maps "X" (uppercase) to "twitter"', () => {
      expect(toApiPlatform('X')).toBe('twitter');
    });

    it('passes through "instagram" unchanged', () => {
      expect(toApiPlatform('instagram')).toBe('instagram');
    });

    it('passes through "linkedin" unchanged', () => {
      expect(toApiPlatform('linkedin')).toBe('linkedin');
    });

    it('lowercases unknown platforms', () => {
      expect(toApiPlatform('TikTok')).toBe('tiktok');
    });
  });

  describe('toDisplayPlatform', () => {
    it('maps "twitter" to "x"', () => {
      expect(toDisplayPlatform('twitter')).toBe('x');
    });

    it('maps "Twitter" (uppercase) to "x"', () => {
      expect(toDisplayPlatform('Twitter')).toBe('x');
    });

    it('passes through "instagram" unchanged', () => {
      expect(toDisplayPlatform('instagram')).toBe('instagram');
    });

    it('passes through "linkedin" unchanged', () => {
      expect(toDisplayPlatform('linkedin')).toBe('linkedin');
    });

    it('lowercases unknown platforms', () => {
      expect(toDisplayPlatform('YouTube')).toBe('youtube');
    });
  });
});

// ─── LateApiClient class ────────────────────────────────────────────────────

describe('LateApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructor requires an apiKey', () => {
    const client = new LateApiClient('my-key');
    expect(client).toBeInstanceOf(LateApiClient);
  });

  it('listPosts sends GET /posts with Authorization header', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { posts: [] }));
    const client = new LateApiClient('my-key');
    await client.listPosts();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/posts');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-key');
  });

  it('listPosts appends query parameters', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { posts: [] }));
    const client = new LateApiClient('my-key');
    await client.listPosts({ status: 'draft', limit: 5 });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('status=draft');
    expect(url).toContain('limit=5');
  });

  it('createPost sends POST with JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, { post: { id: 'p1', content: 'hello' } }),
    );
    const client = new LateApiClient('my-key');
    const result = await client.createPost({
      content: 'hello',
      platforms: [{ platform: 'twitter', accountId: 'acc-1', profileId: 'prof-1' }],
    });
    expect(result).toEqual({ id: 'p1', content: 'hello' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deletePost handles 204 No Content', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    const client = new LateApiClient('my-key');
    await expect(client.deletePost('p1')).resolves.toBeUndefined();
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it('throws on 401 Unauthorized', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(401, { error: 'Unauthorized' }),
    );
    const client = new LateApiClient('bad-key');
    await expect(client.listPosts()).rejects.toThrow(/Late API error.*Unauthorized/);
  });

  it('throws on 500 Internal Server Error', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(500, { error: 'Internal Server Error' }),
    );
    const client = new LateApiClient('my-key');
    await expect(client.listAccounts()).rejects.toThrow(/Late API error.*Internal Server Error/);
  });

  it('retries on 429 then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse(429, null, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(mockFetchResponse(200, { posts: [{ id: 'p1' }] }));
    const client = new LateApiClient('my-key');
    const result = await client.listPosts();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: [{ id: 'p1' }] });
  });

  it('throws after max retries on persistent 429', async () => {
    for (let i = 0; i <= 3; i++) {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(429, null, { 'Retry-After': '0' }));
    }
    const client = new LateApiClient('my-key');
    await expect(client.listPosts()).rejects.toThrow(/Late API error/);
  });

  it('uses error.message field from response when available', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(400, { message: 'Invalid request body' }),
    );
    const client = new LateApiClient('my-key');
    await expect(client.listPosts()).rejects.toThrow(/Invalid request body/);
  });

  // ── extractArray logic ────────────────────────────────────────────────

  it('extracts array from single-key wrapped response', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, { accounts: [{ id: 'a1' }, { id: 'a2' }] }),
    );
    const client = new LateApiClient('my-key');
    const result = await client.listAccounts();
    expect(result).toEqual({ data: [{ id: 'a1' }, { id: 'a2' }] });
  });

  it('extracts array from multi-key wrapped response (picks first array)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, { posts: [{ id: 'p1' }], pagination: { page: 1 } }),
    );
    const client = new LateApiClient('my-key');
    const result = await client.listPosts();
    expect(result).toEqual({ data: [{ id: 'p1' }], pagination: { page: 1 } });
  });

  it('returns empty array when response has no array values', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, { count: 0 }),
    );
    const client = new LateApiClient('my-key');
    const result = await client.listPosts();
    expect(result).toEqual({ data: [], pagination: undefined });
  });

  it('returns raw array when response is already an array', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(200, [{ id: 'p1' }, { id: 'p2' }]),
    );
    const client = new LateApiClient('my-key');
    const result = await client.listProfiles();
    expect(result).toEqual({ data: [{ id: 'p1' }, { id: 'p2' }] });
  });
});

// ─── LateApiClient — additional method coverage ─────────────────────────────

describe('LateApiClient — method coverage', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: LateApiClient;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    client = new LateApiClient('test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── GET with URL params ────────────────────────────────────────────────

  it('getPost sends GET /posts/:id and unwraps post key', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { post: { id: 'p1', content: 'hi' } }));
    const result = await client.getPost('p1');
    expect(result).toEqual({ id: 'p1', content: 'hi' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/posts/p1');
    expect(init.method).toBe('GET');
  });

  it('getPost returns data directly when not wrapped', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { id: 'p2', content: 'raw' }));
    const result = await client.getPost('p2');
    expect(result).toEqual({ id: 'p2', content: 'raw' });
  });

  it('getAccountHealth sends GET /accounts/:id/health', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { status: 'healthy' }));
    const result = await client.getAccountHealth('acc1');
    expect(result).toEqual({ status: 'healthy' });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/accounts/acc1/health');
  });

  it('getAllAccountsHealth sends GET /accounts/health', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { items: [{ id: 'a1', status: 'ok' }] }));
    const result = await client.getAllAccountsHealth();
    expect(result).toEqual([{ id: 'a1', status: 'ok' }]);
  });

  it('getUsageStats sends GET /usage', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { plan: 'pro', postsUsed: 10 }));
    const result = await client.getUsageStats();
    expect(result).toEqual({ plan: 'pro', postsUsed: 10 });
  });

  it('getPostLogs sends GET /logs/posts/:id', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { logs: [{ id: 'l1', action: 'publish' }] }));
    const result = await client.getPostLogs('p1');
    expect(result).toEqual({ data: [{ id: 'l1', action: 'publish' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/logs/posts/p1');
  });

  // ── GET with query params ─────────────────────────────────────────────

  it('getAnalytics sends GET /analytics with query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [{ impressions: 100 }] }));
    const result = await client.getAnalytics({ platform: 'twitter', limit: 10 });
    expect(result).toEqual({ data: [{ impressions: 100 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/analytics');
    expect(url).toContain('platform=twitter');
    expect(url).toContain('limit=10');
  });

  it('getDailyMetrics sends GET /analytics/daily', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { metrics: [{ date: '2024-01-01', impressions: 50 }] }));
    const result = await client.getDailyMetrics({ dateFrom: '2024-01-01', dateTo: '2024-01-31' });
    expect(result).toEqual({ data: [{ date: '2024-01-01', impressions: 50 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/analytics/daily');
    expect(url).toContain('dateFrom=2024-01-01');
  });

  it('getFollowerStats sends GET /accounts/followers', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { stats: [{ followers: 500 }] }));
    const result = await client.getFollowerStats({ accountId: 'acc1' });
    expect(result).toEqual({ data: [{ followers: 500 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/accounts/followers');
  });

  it('getPostTimeline sends GET /analytics/post-timeline with postId', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { timeline: [{ date: '2024-01-01', likes: 10 }] }));
    const result = await client.getPostTimeline('p1', { dateFrom: '2024-01-01' });
    expect(result).toEqual({ data: [{ date: '2024-01-01', likes: 10 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/analytics/post-timeline');
    expect(url).toContain('postId=p1');
  });

  it('getYouTubeDailyViews sends GET /analytics/youtube-daily-views', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { views: [{ date: '2024-01-01', count: 1000 }] }));
    const result = await client.getYouTubeDailyViews('vid1');
    expect(result).toEqual({ data: [{ date: '2024-01-01', count: 1000 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('videoId=vid1');
  });

  it('listQueues sends GET /queue with profileId', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { queues: [{ id: 'q1' }] }));
    const result = await client.listQueues('prof1');
    expect(result).toEqual([{ id: 'q1' }]);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('profileId=prof1');
    expect(url).toContain('all=true');
  });

  it('previewQueueSlots sends GET /queue/preview', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { slots: [{ time: '09:00' }] }));
    const result = await client.previewQueueSlots('prof1', { count: 5 });
    expect(result).toEqual([{ time: '09:00' }]);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/queue/preview');
    expect(url).toContain('count=5');
  });

  it('listConversations sends GET /inbox/conversations', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { conversations: [{ id: 'c1' }] }));
    const result = await client.listConversations({ platform: 'instagram', limit: 5 });
    expect(result).toEqual({ data: [{ id: 'c1' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/conversations');
    expect(url).toContain('platform=instagram');
  });

  it('getConversation sends GET /inbox/conversations/:id with accountId', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { id: 'c1', messages: [] }));
    const result = await client.getConversation('c1', 'acc1');
    expect(result).toEqual({ id: 'c1', messages: [] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/conversations/c1');
    expect(url).toContain('accountId=acc1');
  });

  it('listMessages sends GET /inbox/conversations/:id/messages', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { messages: [{ id: 'm1', text: 'hi' }] }));
    const result = await client.listMessages('c1', 'acc1', { limit: 10 });
    expect(result).toEqual({ data: [{ id: 'm1', text: 'hi' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/conversations/c1/messages');
    expect(url).toContain('accountId=acc1');
  });

  it('listCommentedPosts sends GET /inbox/comments', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { posts: [{ id: 'p1' }] }));
    const result = await client.listCommentedPosts({ platform: 'instagram' });
    expect(result).toEqual({ data: [{ id: 'p1' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/comments');
  });

  it('getPostComments sends GET /inbox/comments/:postId', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { comments: [{ id: 'cm1', text: 'nice' }] }));
    const result = await client.getPostComments('p1', { accountId: 'acc1' });
    expect(result).toEqual({ data: [{ id: 'cm1', text: 'nice' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/comments/p1');
  });

  it('listReviews sends GET /inbox/reviews', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { reviews: [{ id: 'r1', rating: 5 }] }));
    const result = await client.listReviews({ platform: 'google-business' });
    expect(result).toEqual({ data: [{ id: 'r1', rating: 5 }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/inbox/reviews');
  });

  it('listWebhooks sends GET /webhooks', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { webhooks: [{ id: 'w1', url: 'https://example.com' }] }));
    const result = await client.listWebhooks();
    expect(result).toEqual([{ id: 'w1', url: 'https://example.com' }]);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/webhooks');
  });

  it('listPublishingLogs sends GET /logs/publishing with query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { logs: [{ id: 'l1', status: 'success' }] }));
    const result = await client.listPublishingLogs({ status: 'success', limit: 5 });
    expect(result).toEqual({ data: [{ id: 'l1', status: 'success' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/logs/publishing');
    expect(url).toContain('status=success');
  });

  it('listConnectionLogs sends GET /logs/connections', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { logs: [{ id: 'l2', platform: 'twitter' }] }));
    const result = await client.listConnectionLogs({ platform: 'twitter' });
    expect(result).toEqual({ data: [{ id: 'l2', platform: 'twitter' }] });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('/logs/connections');
  });

  // ── PUT methods ───────────────────────────────────────────────────────

  it('updatePost sends PUT /posts/:id with body', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { post: { id: 'p1', content: 'updated' } }));
    const result = await client.updatePost('p1', { content: 'updated' } as Parameters<LateApiClient['updatePost']>[1]);
    expect(result).toEqual({ id: 'p1', content: 'updated' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/posts/p1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'updated' });
  });

  it('updateQueue sends PUT /queue with body and returns void', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.updateQueue({ profileId: 'prof1', days: ['mon'] } as Parameters<LateApiClient['updateQueue']>[0])).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/queue');
    expect(init.method).toBe('PUT');
  });

  it('updateWebhook sends PUT /webhooks with webhookId in body', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { id: 'w1', url: 'https://new.com' }));
    const result = await client.updateWebhook('w1', { url: 'https://new.com' });
    expect(result).toEqual({ id: 'w1', url: 'https://new.com' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/webhooks');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)._id).toBe('w1');
  });

  it('editMessage sends PUT /inbox/conversations/:cid/messages/:mid', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.editMessage('c1', 'm1', 'edited text')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/conversations/c1/messages/m1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'edited text' });
  });

  // ── POST methods ──────────────────────────────────────────────────────

  it('retryPost sends POST /posts/:id/retry', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { post: { id: 'p1', status: 'scheduled' } }));
    const result = await client.retryPost('p1');
    expect(result).toEqual({ id: 'p1', status: 'scheduled' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/posts/p1/retry');
    expect(init.method).toBe('POST');
  });

  it('sendMessage sends POST /inbox/conversations/:cid/messages', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { success: true }));
    const result = await client.sendMessage('c1', 'acc1', 'hello');
    expect(result).toEqual({ success: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/conversations/c1/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'acc1', message: 'hello' });
  });

  it('replyToComment sends POST /inbox/comments/:postId/reply', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { success: true }));
    const result = await client.replyToComment('p1', 'acc1', 'cm1', 'thanks!');
    expect(result).toEqual({ success: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/comments/p1/reply');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'acc1', commentId: 'cm1', message: 'thanks!' });
  });

  it('replyToReview sends POST /inbox/reviews/:reviewId/reply', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { success: true }));
    const result = await client.replyToReview('r1', 'acc1', 'thank you!');
    expect(result).toEqual({ success: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/reviews/r1/reply');
    expect(init.method).toBe('POST');
  });

  it('sendPrivateReply sends POST /inbox/comments/:commentId/private-reply', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { success: true }));
    const result = await client.sendPrivateReply('cm1', 'acc1', 'private msg');
    expect(result).toEqual({ success: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/comments/cm1/private-reply');
    expect(init.method).toBe('POST');
  });

  it('createWebhook sends POST /webhooks with url and events', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { id: 'w1', url: 'https://hook.com', events: ['post.published'] }));
    const result = await client.createWebhook('https://hook.com', ['post.published'], 'My Hook');
    expect(result).toEqual({ id: 'w1', url: 'https://hook.com', events: ['post.published'] });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://hook.com', events: ['post.published'], name: 'My Hook' });
  });

  it('createWebhook omits name when not provided', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { id: 'w2' }));
    await client.createWebhook('https://hook.com', ['post.published']);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('name');
  });

  it('testWebhook sends POST /webhooks/test', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { success: true, statusCode: 200 }));
    const result = await client.testWebhook('w1');
    expect(result).toEqual({ success: true, statusCode: 200 });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/webhooks/test');
    expect(JSON.parse(init.body as string)).toEqual({ webhookId: 'w1' });
  });

  it('getPresignedUrl sends POST /media/presign', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { uploadUrl: 'https://s3.example.com/upload', publicUrl: 'https://cdn.example.com/file.jpg' }));
    const result = await client.getPresignedUrl('file.jpg', 'image/jpeg');
    expect(result).toEqual({ uploadUrl: 'https://s3.example.com/upload', publicUrl: 'https://cdn.example.com/file.jpg' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ filename: 'file.jpg', mimeType: 'image/jpeg' });
  });

  it('validateMedia sends POST /validate/media', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { valid: true }));
    const result = await client.validateMedia('https://img.com/a.jpg', ['twitter', 'instagram']);
    expect(result).toEqual({ valid: true });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      platforms: ['twitter', 'instagram'],
      mediaItems: [{ url: 'https://img.com/a.jpg' }],
    });
  });

  it('validatePost sends POST /validate/post with mediaUrls', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { valid: true }));
    const result = await client.validatePost('hello', ['twitter'], ['https://img.com/a.jpg']);
    expect(result).toEqual({ valid: true });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.content).toBe('hello');
    expect(body.mediaItems).toEqual([{ url: 'https://img.com/a.jpg' }]);
  });

  it('validatePost sends POST /validate/post without mediaUrls', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { valid: true }));
    await client.validatePost('hello', ['twitter']);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('mediaItems');
  });

  it('validatePostLength sends POST /validate/post-length', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { twitter: { length: 5, limit: 280, valid: true } }));
    const result = await client.validatePostLength('hello', ['twitter']);
    expect(result).toEqual({ twitter: { length: 5, limit: 280, valid: true } });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/validate/post-length');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello', platforms: ['twitter'] });
  });

  it('checkInstagramHashtags sends POST /tools/instagram-hashtags', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { results: [{ tag: 'food', status: 'safe' }] }));
    const result = await client.checkInstagramHashtags(['food', 'travel']);
    expect(result).toEqual({ results: [{ tag: 'food', status: 'safe' }] });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/tools/instagram-hashtags');
    expect(JSON.parse(init.body as string)).toEqual({ hashtags: ['food', 'travel'] });
  });

  // ── POST/DELETE returning void ────────────────────────────────────────

  it('unpublishPost sends POST /posts/:id/unpublish and returns void', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.unpublishPost('p1', ['twitter'])).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/posts/p1/unpublish');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ platforms: ['twitter'] });
  });

  it('createQueue sends POST /queue and returns void', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.createQueue({ profileId: 'prof1', days: ['mon', 'tue'], times: ['09:00'] } as Parameters<LateApiClient['createQueue']>[0])).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/queue');
    expect(init.method).toBe('POST');
  });

  it('hideComment sends POST /inbox/comments/:id/hide and returns void', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.hideComment('cm1', 'acc1')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/comments/cm1/hide');
    expect(init.method).toBe('POST');
  });

  it('likeComment sends POST /inbox/comments/:id/like and returns void', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.likeComment('cm1', 'acc1')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/comments/cm1/like');
    expect(init.method).toBe('POST');
  });

  // ── DELETE methods ────────────────────────────────────────────────────

  it('deleteQueue sends DELETE /queue with query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.deleteQueue('prof1', 'q1')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/queue');
    expect(url).toContain('profileId=prof1');
    expect(url).toContain('queueId=q1');
    expect(init.method).toBe('DELETE');
  });

  it('deleteComment sends DELETE /inbox/comments/:id with body', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.deleteComment('cm1', 'acc1')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/comments/cm1');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'acc1' });
  });

  it('deleteReviewReply sends DELETE /inbox/reviews/:id with body', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(204));
    await expect(client.deleteReviewReply('rr1', 'acc1')).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/inbox/reviews/rr1');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'acc1' });
  });
});

// ─── getClient / resetClient singleton ──────────────────────────────────────

describe('getClient & resetClient', () => {
  afterEach(() => {
    resetClient();
  });

  it('getClient() returns a LateApiClient instance', () => {
    const client = getClient();
    expect(client).toBeInstanceOf(LateApiClient);
  });

  it('getClient() returns the same instance on subsequent calls (singleton)', () => {
    const first = getClient();
    const second = getClient();
    expect(first).toBe(second);
  });

  it('resetClient() clears the cached instance', () => {
    const first = getClient();
    resetClient();
    const second = getClient();
    expect(first).not.toBe(second);
  });

  it('getClient() throws when API key is not configured', async () => {
    const { getLateApiKey } = await import('../../src/config/config.js');
    vi.mocked(getLateApiKey).mockReturnValueOnce(undefined as unknown as string);
    resetClient();
    expect(() => getClient()).toThrowError(
      'Late API key not configured. Set LATE_API_KEY environment variable.',
    );
  });
});
