import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that trigger side-effects
// ---------------------------------------------------------------------------

vi.mock('../../src/server.js', () => ({
  server: { tool: vi.fn() },
}));

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(),
  unwrap: vi.fn((result: { data?: unknown; error?: unknown }) => {
    if (result.error) throw new Error(String(result.error));
    return result.data;
  }),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
}));

vi.mock('../../src/config/config.js', () => ({
  getLateApiKey: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  CONFIG_FILE: '/mock/late-social-mcp.config.json',
}));

vi.mock('../../src/config/scheduleConfig.js', () => ({
  validateScheduleConfig: vi.fn(() => true),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { server } from '../../src/server.js';
import { getClient, unwrap } from '../../src/client/lateClient.js';
import { getLateApiKey, loadConfig, saveConfig } from '../../src/config/config.js';
import { validateScheduleConfig } from '../../src/config/scheduleConfig.js';
import * as fs from 'node:fs';

// Trigger tool registration via side-effect imports
await import('../../src/tools/setup.js');
await import('../../src/tools/posts.js');

// ---------------------------------------------------------------------------
// Handler extraction helpers (mirrors analytics.test.ts pattern)
// ---------------------------------------------------------------------------

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function getToolHandler(toolName: string): ToolHandler {
  const handler = toolHandlers.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not registered`);
  return handler;
}

// ---------------------------------------------------------------------------
// SDK mock factory
// ---------------------------------------------------------------------------

function mockSdk(overrides: Record<string, unknown> = {}) {
  const sdk = {
    profiles: {
      listProfiles: vi.fn().mockResolvedValue({ data: [] }),
    },
    accounts: {
      listAccounts: vi.fn().mockResolvedValue({ data: [] }),
    },
    usage: {
      getUsageStats: vi.fn().mockResolvedValue({ data: {} }),
    },
    posts: {
      listPosts: vi.fn().mockResolvedValue({ data: [] }),
      getPost: vi.fn().mockResolvedValue({ data: {} }),
      createPost: vi.fn().mockResolvedValue({ data: {} }),
      updatePost: vi.fn().mockResolvedValue({ data: {} }),
      deletePost: vi.fn().mockResolvedValue({ data: {} }),
      retryPost: vi.fn().mockResolvedValue({ data: {} }),
      unpublishPost: vi.fn().mockResolvedValue({ data: {} }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

describe('tool registration', () => {
  it('registers all setup tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('setup_late');
    expect(names).toContain('late_status');
    expect(names).toContain('import_schedule_config');
  });

  it('registers all post tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('list_posts');
    expect(names).toContain('get_post');
    expect(names).toContain('create_post');
    expect(names).toContain('update_post');
    expect(names).toContain('delete_post');
    expect(names).toContain('retry_post');
    expect(names).toContain('unpublish_post');
    expect(names).toContain('bulk_upload_posts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SETUP TOOLS
// ═══════════════════════════════════════════════════════════════════════════

describe('setup_late', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when API key is not set', async () => {
    vi.mocked(getLateApiKey).mockReturnValue(undefined);

    const handler = getToolHandler('setup_late');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('LATE_API_KEY');
    expect(result.content[0].text).toContain('not set');
  });

  it('succeeds with profiles and accounts', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key-123');
    const sdk = mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce([
        { name: 'Main Profile', description: 'My brand' },
      ])
      .mockReturnValueOnce([
        { isActive: true, platform: 'instagram', username: 'testuser', displayName: 'Test User' },
      ]);

    const handler = getToolHandler('setup_late');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('connection successful');
    expect(result.content[0].text).toContain('Profiles found: 1');
    expect(result.content[0].text).toContain('Connected accounts: 1');
    expect(result.content[0].text).toContain('✓');
    expect(result.content[0].text).toContain('@testuser');
    expect(saveConfig).toHaveBeenCalled();
  });

  it('shows inactive account with ✗ marker', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key');
    mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { isActive: false, platform: 'twitter', username: 'old', displayName: 'Old Account' },
      ]);

    const handler = getToolHandler('setup_late');
    const result = await handler({});

    expect(result.content[0].text).toContain('✗');
    expect(result.content[0].text).toContain('@old');
  });

  it('handles empty profiles and accounts', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key');
    mockSdk();
    vi.mocked(unwrap).mockReturnValueOnce([]).mockReturnValueOnce([]);

    const handler = getToolHandler('setup_late');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Profiles found: 0');
    expect(result.content[0].text).toContain('Connected accounts: 0');
  });

  it('returns error on SDK failure', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key');
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Network timeout');
    });

    const handler = getToolHandler('setup_late');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Setup failed');
    expect(result.content[0].text).toContain('Network timeout');
  });
});

describe('late_status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when not connected', async () => {
    vi.mocked(getLateApiKey).mockReturnValue(undefined);

    const handler = getToolHandler('late_status');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not connected');
  });

  it('returns full status with profiles, accounts, usage', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key');
    mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce([{ name: 'Brand', description: 'Main brand' }])
      .mockReturnValueOnce([
        { isActive: true, platform: 'instagram', username: 'brand', displayName: 'Brand IG' },
      ])
      .mockReturnValueOnce({ postsPublished: 42, postsScheduled: 5 });

    const handler = getToolHandler('late_status');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Late Social MCP Status');
    expect(result.content[0].text).toContain('Connection: Active');
    expect(result.content[0].text).toContain('Brand');
    expect(result.content[0].text).toContain('🟢');
    expect(result.content[0].text).toContain('@brand');
    expect(result.content[0].text).toContain('42');
  });

  it('shows empty state for no profiles', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('test-key');
    mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce(null);

    const handler = getToolHandler('late_status');
    const result = await handler({});

    expect(result.content[0].text).toContain('No profiles found');
    expect(result.content[0].text).toContain('No accounts connected');
    expect(result.content[0].text).toContain('No usage data available');
  });

  it('shows inactive account with red indicator', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('key');
    mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { isActive: false, platform: 'linkedin', username: 'corp', displayName: 'Corp LI' },
      ])
      .mockReturnValueOnce({});

    const handler = getToolHandler('late_status');
    const result = await handler({});

    expect(result.content[0].text).toContain('🔴');
  });

  it('returns error on SDK failure', async () => {
    vi.mocked(getLateApiKey).mockReturnValue('key');
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Unauthorized');
    });

    const handler = getToolHandler('late_status');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get status');
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('import_schedule_config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error for invalid JSON', async () => {
    const handler = getToolHandler('import_schedule_config');
    const result = await handler({ config: 'not json {{{' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid JSON');
  });

  it('returns error for invalid schedule structure', async () => {
    vi.mocked(validateScheduleConfig).mockReturnValue(false);

    const handler = getToolHandler('import_schedule_config');
    const result = await handler({ config: '{"foo": "bar"}' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid schedule config');
  });

  it('successfully imports valid schedule config', async () => {
    vi.mocked(validateScheduleConfig).mockReturnValue(true);

    const validConfig = {
      timezone: 'America/New_York',
      platforms: {
        twitter: {
          slots: [{ days: ['mon', 'tue'], time: '09:00', label: 'Morning' }],
          avoidDays: ['sun'],
        },
      },
    };

    const handler = getToolHandler('import_schedule_config');
    const result = await handler({ config: JSON.stringify(validConfig) });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('imported successfully');
    expect(result.content[0].text).toContain('America/New_York');
    expect(result.content[0].text).toContain('twitter');
    expect(result.content[0].text).toContain('Morning');
    expect(result.content[0].text).toContain('09:00');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('reports multiple platforms and slot counts', async () => {
    vi.mocked(validateScheduleConfig).mockReturnValue(true);

    const multiConfig = {
      timezone: 'Europe/London',
      platforms: {
        twitter: {
          slots: [
            { days: ['mon'], time: '09:00', label: 'AM' },
            { days: ['wed'], time: '14:00', label: 'PM' },
          ],
          avoidDays: [],
        },
        instagram: {
          slots: [{ days: ['fri'], time: '18:00', label: 'Evening' }],
          avoidDays: ['sat'],
        },
      },
    };

    const handler = getToolHandler('import_schedule_config');
    const result = await handler({ config: JSON.stringify(multiConfig) });

    expect(result.content[0].text).toContain('Total time slots: 3');
    expect(result.content[0].text).toContain('instagram');
    expect(result.content[0].text).toContain('Avoid: sat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST TOOLS
// ═══════════════════════════════════════════════════════════════════════════

describe('list_posts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted post list', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      {
        id: 'post-1',
        status: 'scheduled',
        content: 'Hello world',
        platforms: ['twitter', 'instagram'],
        scheduledFor: '2025-07-15T10:00:00Z',
      },
    ]);

    const handler = getToolHandler('list_posts');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Posts');
    expect(result.content[0].text).toContain('post-1');
    expect(result.content[0].text).toContain('scheduled');
    expect(result.content[0].text).toContain('Hello world');
  });

  it('returns empty message when no posts found', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_posts');
    const result = await handler({});

    expect(result.content[0].text).toContain('No posts found');
  });

  it('includes filter info in empty message', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_posts');
    const result = await handler({ status: 'draft', platform: 'instagram' });

    expect(result.content[0].text).toContain('No posts found');
    expect(result.content[0].text).toContain('status=draft');
    expect(result.content[0].text).toContain('platform=instagram');
  });

  it('passes filters to the SDK', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_posts');
    await handler({ status: 'published', platform: 'x', search: 'hello', limit: 5, page: 2 });

    expect(sdk.posts.listPosts).toHaveBeenCalledWith({
      query: {
        status: 'published',
        platform: 'twitter', // 'x' normalised to 'twitter'
        search: 'hello',
        limit: 5,
        page: 2,
      },
    });
  });

  it('returns multiple posts formatted with indices', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { id: 'p1', status: 'draft', content: 'First', platforms: ['twitter'], scheduledFor: null },
      { id: 'p2', status: 'published', content: 'Second', platforms: ['instagram'], scheduledFor: null },
    ]);

    const handler = getToolHandler('list_posts');
    const result = await handler({});

    expect(result.content[0].text).toContain('2 results');
    expect(result.content[0].text).toContain('p1');
    expect(result.content[0].text).toContain('p2');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Server error');
    });

    const handler = getToolHandler('list_posts');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list posts');
  });
});

describe('get_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns full post details', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({
      id: 'post-42',
      status: 'published',
      content: 'Detailed content here',
      platforms: ['twitter'],
      scheduledFor: '2025-07-15T10:00:00Z',
      createdAt: '2025-07-10T08:00:00Z',
      updatedAt: '2025-07-14T12:00:00Z',
      platformPostUrl: 'https://twitter.com/user/status/123',
      mediaItems: [
        { type: 'image', url: 'https://example.com/img.png', altText: 'A photo' },
      ],
    });

    const handler = getToolHandler('get_post');
    const result = await handler({ postId: 'post-42' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Details');
    expect(result.content[0].text).toContain('post-42');
    expect(result.content[0].text).toContain('published');
    expect(result.content[0].text).toContain('Detailed content here');
    expect(result.content[0].text).toContain('https://twitter.com/user/status/123');
    expect(result.content[0].text).toContain('Media');
    expect(result.content[0].text).toContain('A photo');
  });

  it('calls SDK with correct postId', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({
      id: 'abc', status: 'draft', content: '', platforms: [],
    });

    const handler = getToolHandler('get_post');
    await handler({ postId: 'abc' });

    expect(sdk.posts.getPost).toHaveBeenCalledWith({ path: { postId: 'abc' } });
  });

  it('returns error on not-found', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Post not found');
    });

    const handler = getToolHandler('get_post');
    const result = await handler({ postId: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get post');
    expect(result.content[0].text).toContain('Post not found');
  });
});

describe('create_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a post with platforms', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'new-1', status: 'scheduled' });

    const handler = getToolHandler('create_post');
    const result = await handler({
      content: 'My new post',
      platforms: 'twitter, instagram',
      scheduledFor: '2025-08-01T12:00:00Z',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('scheduled successfully');
    expect(result.content[0].text).toContain('new-1');
    expect(sdk.posts.createPost).toHaveBeenCalledWith({
      body: {
        content: 'My new post',
        platforms: ['twitter', 'instagram'],
        scheduledFor: '2025-08-01T12:00:00Z',
      },
    });
  });

  it('normalises x to twitter in platform list', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'p1', status: 'draft' });

    const handler = getToolHandler('create_post');
    await handler({ content: 'test', platforms: 'x, linkedin' });

    const callBody = (sdk.posts.createPost as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
    expect(callBody.platforms).toContain('twitter');
    expect(callBody.platforms).toContain('linkedin');
  });

  it('handles publishNow flag', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'p1', status: 'published' });

    const handler = getToolHandler('create_post');
    const result = await handler({
      content: 'Immediate',
      platforms: 'twitter',
      publishNow: true,
    });

    expect(result.content[0].text).toContain('published successfully');
  });

  it('handles isDraft flag', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'p1', status: 'draft' });

    const handler = getToolHandler('create_post');
    const result = await handler({
      content: 'Draft content',
      platforms: 'instagram',
      isDraft: true,
    });

    expect(result.content[0].text).toContain('saved as draft');
  });

  it('includes mediaUrls in request', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'p1', status: 'scheduled' });

    const handler = getToolHandler('create_post');
    await handler({
      content: 'With media',
      platforms: 'twitter',
      mediaUrls: 'https://img1.jpg, https://img2.png',
    });

    const callBody = (sdk.posts.createPost as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
    expect(callBody.mediaUrls).toEqual(['https://img1.jpg', 'https://img2.png']);
  });

  it('returns error for empty platforms', async () => {
    const handler = getToolHandler('create_post');
    const result = await handler({ content: 'test', platforms: '  ,  , ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('At least one platform');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Rate limit exceeded');
    });

    const handler = getToolHandler('create_post');
    const result = await handler({ content: 'test', platforms: 'twitter' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create post');
    expect(result.content[0].text).toContain('Rate limit exceeded');
  });

  it('shows scheduled time in response when provided', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'p1', status: 'scheduled' });

    const handler = getToolHandler('create_post');
    const result = await handler({
      content: 'Scheduled post',
      platforms: 'twitter',
      scheduledFor: '2025-12-25T00:00:00Z',
    });

    expect(result.content[0].text).toContain('Scheduled for:');
  });
});

describe('update_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates post content', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'up-1', status: 'scheduled' });

    const handler = getToolHandler('update_post');
    const result = await handler({ postId: 'up-1', content: 'Updated content' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('updated successfully');
    expect(result.content[0].text).toContain('up-1');
    expect(result.content[0].text).toContain('content');
    expect(sdk.posts.updatePost).toHaveBeenCalledWith({
      path: { postId: 'up-1' },
      body: { content: 'Updated content' },
    });
  });

  it('updates schedule', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'up-2', status: 'scheduled' });

    const handler = getToolHandler('update_post');
    const result = await handler({
      postId: 'up-2',
      scheduledFor: '2025-09-01T15:00:00Z',
    });

    expect(result.content[0].text).toContain('schedule');
    expect(result.content[0].text).toContain('New schedule:');
  });

  it('returns error when nothing to update', async () => {
    const handler = getToolHandler('update_post');
    const result = await handler({ postId: 'some-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Nothing to update');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Post not found');
    });

    const handler = getToolHandler('update_post');
    const result = await handler({ postId: 'bad-id', content: 'new' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to update post');
  });
});

describe('delete_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a post successfully', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue(undefined);

    const handler = getToolHandler('delete_post');
    const result = await handler({ postId: 'del-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('del-1');
    expect(result.content[0].text).toContain('deleted successfully');
    expect(sdk.posts.deletePost).toHaveBeenCalledWith({ path: { postId: 'del-1' } });
  });

  it('returns error on not-found', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Not found');
    });

    const handler = getToolHandler('delete_post');
    const result = await handler({ postId: 'missing' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to delete post');
    expect(result.content[0].text).toContain('Not found');
  });
});

describe('retry_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries a failed post', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({
      id: 'retry-1',
      status: 'pending',
      platforms: ['twitter', 'instagram'],
    });

    const handler = getToolHandler('retry_post');
    const result = await handler({ postId: 'retry-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('retry initiated');
    expect(result.content[0].text).toContain('retry-1');
    expect(result.content[0].text).toContain('pending');
    expect(result.content[0].text).toContain('twitter, instagram');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Cannot retry: already published');
    });

    const handler = getToolHandler('retry_post');
    const result = await handler({ postId: 'pub-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to retry post');
    expect(result.content[0].text).toContain('Cannot retry');
  });
});

describe('unpublish_post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unpublishes from specified platforms', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue(undefined);

    const handler = getToolHandler('unpublish_post');
    const result = await handler({ postId: 'unp-1', platforms: 'twitter, instagram' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('unpublished successfully');
    expect(result.content[0].text).toContain('unp-1');
    expect(result.content[0].text).toContain('twitter, instagram');
    expect(sdk.posts.unpublishPost).toHaveBeenCalledWith({
      path: { postId: 'unp-1' },
      body: { platforms: ['twitter', 'instagram'] },
    });
  });

  it('normalises x to twitter', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue(undefined);

    const handler = getToolHandler('unpublish_post');
    await handler({ postId: 'unp-2', platforms: 'x' });

    expect(sdk.posts.unpublishPost).toHaveBeenCalledWith({
      path: { postId: 'unp-2' },
      body: { platforms: ['twitter'] },
    });
  });

  it('returns error for empty platforms', async () => {
    const handler = getToolHandler('unpublish_post');
    const result = await handler({ postId: 'unp-3', platforms: '  ,  ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('At least one platform');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Not found');
    });

    const handler = getToolHandler('unpublish_post');
    const result = await handler({ postId: 'bad', platforms: 'twitter' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to unpublish');
  });
});

describe('bulk_upload_posts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error for empty CSV', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const result = await handler({ csvContent: '' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('empty');
  });

  it('returns error when required columns missing', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const result = await handler({ csvContent: 'title,body\nHi,World' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content');
    expect(result.content[0].text).toContain('platforms');
  });

  it('returns error for headers only, no data rows', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const result = await handler({ csvContent: 'content,platforms,scheduledFor' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no data rows');
  });

  it('returns dry-run preview', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const csv = [
      'content,platforms,scheduledFor',
      '"Hello world","twitter|instagram","2025-08-01T12:00:00Z"',
      '"Second post","linkedin",""',
    ].join('\n');

    const result = await handler({ csvContent: csv, dryRun: true });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Preview');
    expect(result.content[0].text).toContain('2 posts');
    expect(result.content[0].text).toContain('dry run');
    expect(result.content[0].text).toContain('Hello world');
    expect(result.content[0].text).toContain('Second post');
  });

  it('creates posts in bulk and reports results', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce({ id: 'bulk-1' })
      .mockReturnValueOnce({ id: 'bulk-2' });

    const handler = getToolHandler('bulk_upload_posts');
    const csv = [
      'content,platforms,scheduledFor',
      'Post A,twitter,2025-09-01T10:00:00Z',
      'Post B,instagram,',
    ].join('\n');

    const result = await handler({ csvContent: csv });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Bulk Upload Complete');
    expect(result.content[0].text).toContain('Created: 2');
    expect(result.content[0].text).toContain('Failed: 0');
    expect(result.content[0].text).toContain('bulk-1');
    expect(result.content[0].text).toContain('bulk-2');
  });

  it('reports partial failures', async () => {
    mockSdk();
    vi.mocked(unwrap)
      .mockReturnValueOnce({ id: 'ok-1' })
      .mockImplementationOnce(() => {
        throw new Error('Invalid platform');
      });

    const handler = getToolHandler('bulk_upload_posts');
    const csv = [
      'content,platforms',
      'Good post,twitter',
      'Bad post,invalid',
    ].join('\n');

    const result = await handler({ csvContent: csv });

    expect(result.content[0].text).toContain('Created: 1');
    expect(result.content[0].text).toContain('Failed: 1');
    expect(result.content[0].text).toContain('Invalid platform');
  });

  it('returns error for row with empty content', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const csv = 'content,platforms\n,twitter';

    const result = await handler({ csvContent: csv });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Content is empty');
  });

  it('returns error for row with empty platforms', async () => {
    const handler = getToolHandler('bulk_upload_posts');
    const csv = 'content,platforms\nHello,';

    const result = await handler({ csvContent: csv });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Platforms are empty');
  });

  it('handles CSV with quoted fields containing commas', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'q1' });

    const handler = getToolHandler('bulk_upload_posts');
    const csv = 'content,platforms\n"Hello, world!",twitter';

    const result = await handler({ csvContent: csv });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Created: 1');
  });

  it('splits platforms on pipe and semicolon delimiters', async () => {
    const sdk = mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'multi-1' });

    const handler = getToolHandler('bulk_upload_posts');
    const csv = 'content,platforms\nTest,twitter|instagram;linkedin';

    await handler({ csvContent: csv });

    const callBody = (sdk.posts.createPost as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
    expect(callBody.platforms).toEqual(['twitter', 'instagram', 'linkedin']);
  });
});
