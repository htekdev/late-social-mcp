import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { server } from '../../src/mcpServer.js';

// Side-effect imports: each module calls server.tool() to register handlers
await import('../../src/tools/accounts.js');
await import('../../src/tools/media.js');
await import('../../src/tools/validate.js');
await import('../../src/tools/webhooks.js');
await import('../../src/tools/logs.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Registration ─────────────────────────────────────────────────────────────

describe('tool registration', () => {
  it('registers all 16 tools across accounts, media, validate, webhooks, and logs', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    const expected = [
      'list_accounts', 'check_account_health', 'list_profiles', 'get_usage_stats',
      'upload_media', 'validate_media',
      'validate_post', 'validate_post_length', 'check_instagram_hashtags',
      'list_webhooks', 'create_webhook', 'update_webhook', 'test_webhook',
      'get_post_logs', 'list_publishing_logs', 'list_connection_logs',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('list_accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted account list', async () => {
    mockClient.listAccounts.mockResolvedValue({ data: [
      { platform: 'twitter', displayName: 'MyBrand', username: 'mybrand', isActive: true },
      { platform: 'instagram', displayName: 'MyInsta', username: 'myinsta', isActive: false },
    ] });

    const result = await getToolHandler('list_accounts')({ platform: 'twitter' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Connected Accounts (2)');
    expect(result.content[0].text).toContain('MyBrand');
    expect(result.content[0].text).toContain('@mybrand');
    expect(result.content[0].text).toContain('✅ Active');
    expect(result.content[0].text).toContain('❌ Inactive');
  });

  it('returns empty message when no accounts', async () => {
    mockClient.listAccounts.mockResolvedValue({ data: [] });

    const result = await getToolHandler('list_accounts')({});

    expect(result.content[0].text).toContain('No connected accounts found');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listAccounts.mockRejectedValue(new Error('Unauthorized'));

    const result = await getToolHandler('list_accounts')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list accounts');
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('check_account_health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns health for a specific account', async () => {
    mockClient.getAccountHealth.mockResolvedValue({
      tokenStatus: 'valid',
      permissions: ['read', 'write'],
      recommendations: ['Enable 2FA'],
    });

    const result = await getToolHandler('check_account_health')({ accountId: 'acc-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Account Health: acc-1');
    expect(result.content[0].text).toContain('Token Status: valid');
    expect(result.content[0].text).toContain('read, write');
    expect(result.content[0].text).toContain('Enable 2FA');
    expect(mockClient.getAccountHealth).toHaveBeenCalledWith('acc-1');
  });

  it('returns health for all accounts when no accountId given', async () => {
    mockClient.getAllAccountsHealth.mockResolvedValue([
      { platform: 'instagram', displayName: 'Insta', tokenStatus: 'valid', permissions: ['read'], recommendations: [] },
    ]);

    const result = await getToolHandler('check_account_health')({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('All Accounts Health');
    expect(result.content[0].text).toContain('Insta');
    expect(result.content[0].text).toContain('Token: valid');
  });

  it('returns empty message when no health data', async () => {
    mockClient.getAllAccountsHealth.mockResolvedValue([]);

    const result = await getToolHandler('check_account_health')({});

    expect(result.content[0].text).toContain('No account health data available');
  });

  it('returns error on SDK failure', async () => {
    mockClient.getAccountHealth.mockRejectedValue(new Error('Timeout'));

    const result = await getToolHandler('check_account_health')({ accountId: 'bad' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to check account health');
    expect(result.content[0].text).toContain('Timeout');
  });
});

describe('list_profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted profile list', async () => {
    mockClient.listProfiles.mockResolvedValue({ data: [
      { _id: 'prof-1', name: 'Marketing', color: '#FF0000', description: 'Marketing team profile' },
      { _id: 'prof-2', name: 'Sales', color: '#00FF00', description: 'Sales team profile' },
    ] });

    const result = await getToolHandler('list_profiles')({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Profiles (2)');
    expect(result.content[0].text).toContain('Marketing');
    expect(result.content[0].text).toContain('prof-1');
    expect(result.content[0].text).toContain('#FF0000');
    expect(result.content[0].text).toContain('Sales');
  });

  it('returns empty message when no profiles', async () => {
    mockClient.listProfiles.mockResolvedValue({ data: [] });

    const result = await getToolHandler('list_profiles')({});

    expect(result.content[0].text).toContain('No profiles found');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listProfiles.mockRejectedValue(new Error('Network error'));

    const result = await getToolHandler('list_profiles')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list profiles');
    expect(result.content[0].text).toContain('Network error');
  });
});

describe('get_usage_stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted usage stats', async () => {
    mockClient.getUsageStats.mockResolvedValue({
      planName: 'Pro',
      billingPeriodStart: '2024-06-01',
      billingPeriodEnd: '2024-06-30',
      limits: { posts: 100, accounts: 10 },
      usage: { posts: 42, accounts: 3 },
    });

    const result = await getToolHandler('get_usage_stats')({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Plan: Pro');
    expect(result.content[0].text).toContain('Billing Period: 2024-06-01');
    expect(result.content[0].text).toContain('2024-06-30');
    expect(result.content[0].text).toContain('posts: 100');
    expect(result.content[0].text).toContain('posts: 42');
  });

  it('handles minimal usage data without limits', async () => {
    mockClient.getUsageStats.mockResolvedValue({ plan: 'Free' });

    const result = await getToolHandler('get_usage_stats')({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Plan: Free');
  });

  it('returns error on SDK failure', async () => {
    mockClient.getUsageStats.mockRejectedValue(new Error('Forbidden'));

    const result = await getToolHandler('get_usage_stats')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get usage stats');
    expect(result.content[0].text).toContain('Forbidden');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════════════════════════

describe('upload_media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns presigned upload URL with instructions', async () => {
    mockClient.getPresignedUrl.mockResolvedValue({
      uploadUrl: 'https://s3.example.com/upload?sig=abc',
      publicUrl: 'https://cdn.example.com/media/photo.jpg',
    });

    const result = await getToolHandler('upload_media')({ filename: 'photo.jpg', mimeType: 'image/jpeg' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Media Upload Ready: photo.jpg');
    expect(result.content[0].text).toContain('MIME Type: image/jpeg');
    expect(result.content[0].text).toContain('https://s3.example.com/upload?sig=abc');
    expect(result.content[0].text).toContain('https://cdn.example.com/media/photo.jpg');
    expect(result.content[0].text).toContain('Instructions:');
    expect(mockClient.getPresignedUrl).toHaveBeenCalledWith('photo.jpg', 'image/jpeg');
  });

  it('returns error on SDK failure', async () => {
    mockClient.getPresignedUrl.mockRejectedValue(new Error('Quota exceeded'));

    const result = await getToolHandler('upload_media')({ filename: 'big.mp4', mimeType: 'video/mp4' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get upload URL');
    expect(result.content[0].text).toContain('Quota exceeded');
  });
});

describe('validate_media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns validation pass when no errors or warnings', async () => {
    mockClient.validateMedia.mockResolvedValue({ errors: [], warnings: [] });

    const result = await getToolHandler('validate_media')({
      mediaUrl: 'https://cdn.example.com/photo.jpg',
      platforms: 'instagram, x',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Media Validation: https://cdn.example.com/photo.jpg');
    expect(result.content[0].text).toContain('instagram, x');
    expect(result.content[0].text).toContain('✅ Media passed all validations');
    expect(mockClient.validateMedia).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg', ['instagram', 'x']);
  });

  it('shows errors and warnings', async () => {
    mockClient.validateMedia.mockResolvedValue({
      errors: [{ platform: 'instagram', message: 'File too large' }],
      warnings: [{ platform: 'x', message: 'Resolution suboptimal' }],
    });

    const result = await getToolHandler('validate_media')({
      mediaUrl: 'https://cdn.example.com/big.png',
      platforms: 'instagram,x',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('❌ [instagram] File too large');
    expect(result.content[0].text).toContain('⚠️ [x] Resolution suboptimal');
  });

  it('returns error on SDK failure', async () => {
    mockClient.validateMedia.mockRejectedValue(new Error('Invalid URL'));

    const result = await getToolHandler('validate_media')({
      mediaUrl: 'bad-url',
      platforms: 'instagram',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to validate media');
    expect(result.content[0].text).toContain('Invalid URL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATE
// ═══════════════════════════════════════════════════════════════════════════════

describe('validate_post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns validation pass when no issues', async () => {
    mockClient.validatePost.mockResolvedValue({ errors: [], warnings: [] });

    const result = await getToolHandler('validate_post')({
      content: 'Hello world!',
      platforms: 'instagram, x',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Validation');
    expect(result.content[0].text).toContain('instagram, x');
    expect(result.content[0].text).toContain('✅ Post passed all validations');
    expect(mockClient.validatePost).toHaveBeenCalledWith('Hello world!', ['instagram', 'x'], undefined);
  });

  it('shows errors and warnings', async () => {
    mockClient.validatePost.mockResolvedValue({
      errors: [{ platform: 'x', message: 'Content too long' }],
      warnings: [{ platform: 'instagram', message: 'No hashtags detected' }],
    });

    const result = await getToolHandler('validate_post')({
      content: 'A'.repeat(300),
      platforms: 'x,instagram',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('❌ [x] Content too long');
    expect(result.content[0].text).toContain('⚠️ [instagram] No hashtags detected');
  });

  it('includes media items when mediaUrls is provided', async () => {
    mockClient.validatePost.mockResolvedValue({ errors: [], warnings: [] });

    await getToolHandler('validate_post')({
      content: 'Photo post',
      platforms: 'instagram',
      mediaUrls: 'https://cdn.example.com/a.jpg, https://cdn.example.com/b.jpg',
    });

    expect(mockClient.validatePost).toHaveBeenCalledWith(
      'Photo post',
      ['instagram'],
      ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    );
  });

  it('returns error on SDK failure', async () => {
    mockClient.validatePost.mockRejectedValue(new Error('Validation service down'));

    const result = await getToolHandler('validate_post')({
      content: 'test',
      platforms: 'x',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to validate post');
    expect(result.content[0].text).toContain('Validation service down');
  });
});

describe('validate_post_length', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns per-platform length check', async () => {
    mockClient.validatePostLength.mockResolvedValue({
      platforms: [
        { platform: 'x', length: 50, maxLength: 280, withinLimit: true },
        { platform: 'instagram', length: 50, maxLength: 2200, withinLimit: true },
      ],
    });

    const result = await getToolHandler('validate_post_length')({
      content: 'Short post',
      platforms: 'x, instagram',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Length Check');
    expect(result.content[0].text).toContain('✅ x: 50/280 chars');
    expect(result.content[0].text).toContain('✅ instagram: 50/2200 chars');
    expect(mockClient.validatePostLength).toHaveBeenCalledWith('Short post', ['x', 'instagram']);
  });

  it('shows failure when content exceeds limit', async () => {
    mockClient.validatePostLength.mockResolvedValue({
      platforms: [
        { platform: 'x', length: 300, maxLength: 280, withinLimit: false },
      ],
    });

    const result = await getToolHandler('validate_post_length')({
      content: 'A'.repeat(300),
      platforms: 'x',
    });

    expect(result.content[0].text).toContain('❌ x: 300/280 chars');
  });

  it('returns error on SDK failure', async () => {
    mockClient.validatePostLength.mockRejectedValue(new Error('Bad request'));

    const result = await getToolHandler('validate_post_length')({
      content: 'test',
      platforms: 'x',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to validate post length');
    expect(result.content[0].text).toContain('Bad request');
  });
});

describe('check_instagram_hashtags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns hashtag status with icons', async () => {
    mockClient.checkInstagramHashtags.mockResolvedValue({
      hashtags: [
        { hashtag: 'travel', status: 'safe' },
        { hashtag: 'banned', status: 'banned' },
        { hashtag: 'risky', status: 'restricted' },
      ],
    });

    const result = await getToolHandler('check_instagram_hashtags')({ hashtags: '#travel, banned, #risky' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Instagram Hashtag Check (3 tags)');
    expect(result.content[0].text).toContain('✅ #travel — safe');
    expect(result.content[0].text).toContain('🚫 #banned — banned');
    expect(result.content[0].text).toContain('⚠️ #risky — restricted');
    expect(mockClient.checkInstagramHashtags).toHaveBeenCalledWith(['travel', 'banned', 'risky']);
  });

  it('handles results array format', async () => {
    mockClient.checkInstagramHashtags.mockResolvedValue({
      results: [
        { name: 'sunset', status: 'safe' },
      ],
    });

    const result = await getToolHandler('check_instagram_hashtags')({ hashtags: 'sunset' });

    expect(result.content[0].text).toContain('✅ #sunset — safe');
  });

  it('returns error on SDK failure', async () => {
    mockClient.checkInstagramHashtags.mockRejectedValue(new Error('Service unavailable'));

    const result = await getToolHandler('check_instagram_hashtags')({ hashtags: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to check hashtags');
    expect(result.content[0].text).toContain('Service unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('list_webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted webhook list', async () => {
    mockClient.listWebhooks.mockResolvedValue([
      { _id: 'wh-1', name: 'Prod Hook', url: 'https://example.com/hook', events: ['post.published', 'post.failed'], isActive: true },
      { _id: 'wh-2', name: 'Dev Hook', url: 'https://dev.example.com/hook', events: ['post.published'], isActive: false },
    ]);

    const result = await getToolHandler('list_webhooks')({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Webhooks (2)');
    expect(result.content[0].text).toContain('Prod Hook');
    expect(result.content[0].text).toContain('wh-1');
    expect(result.content[0].text).toContain('https://example.com/hook');
    expect(result.content[0].text).toContain('post.published, post.failed');
    expect(result.content[0].text).toContain('✅ Active');
    expect(result.content[0].text).toContain('❌ Inactive');
  });

  it('returns empty message when no webhooks', async () => {
    mockClient.listWebhooks.mockResolvedValue([]);

    const result = await getToolHandler('list_webhooks')({});

    expect(result.content[0].text).toContain('No webhooks configured');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listWebhooks.mockRejectedValue(new Error('Internal server error'));

    const result = await getToolHandler('list_webhooks')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list webhooks');
    expect(result.content[0].text).toContain('Internal server error');
  });
});

describe('create_webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns confirmation with created webhook details', async () => {
    mockClient.createWebhook.mockResolvedValue({ _id: 'wh-new', name: 'My Hook' });

    const result = await getToolHandler('create_webhook')({
      url: 'https://example.com/webhook',
      events: 'post.published, post.failed',
      name: 'My Hook',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✅ Webhook created successfully');
    expect(result.content[0].text).toContain('wh-new');
    expect(result.content[0].text).toContain('My Hook');
    expect(result.content[0].text).toContain('https://example.com/webhook');
    expect(result.content[0].text).toContain('post.published, post.failed');
    expect(mockClient.createWebhook).toHaveBeenCalledWith(
      'https://example.com/webhook',
      ['post.published', 'post.failed'],
      'My Hook',
    );
  });

  it('returns error on SDK failure', async () => {
    mockClient.createWebhook.mockRejectedValue(new Error('Duplicate URL'));

    const result = await getToolHandler('create_webhook')({
      url: 'https://dup.example.com/hook',
      events: 'post.published',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to create webhook');
    expect(result.content[0].text).toContain('Duplicate URL');
  });
});

describe('update_webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns confirmation with updated fields', async () => {
    mockClient.updateWebhook.mockResolvedValue({
      name: 'Updated Hook',
      url: 'https://new.example.com/hook',
      isActive: true,
      events: ['post.published'],
    });

    const result = await getToolHandler('update_webhook')({
      webhookId: 'wh-1',
      url: 'https://new.example.com/hook',
      events: 'post.published',
      name: 'Updated Hook',
      isActive: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✅ Webhook updated successfully');
    expect(result.content[0].text).toContain('wh-1');
    expect(result.content[0].text).toContain('Updated Hook');
    expect(result.content[0].text).toContain('https://new.example.com/hook');
    expect(mockClient.updateWebhook).toHaveBeenCalledWith('wh-1', {
      url: 'https://new.example.com/hook',
      name: 'Updated Hook',
      isActive: true,
      events: ['post.published'],
    });
  });

  it('returns error on SDK failure', async () => {
    mockClient.updateWebhook.mockRejectedValue(new Error('Not found'));

    const result = await getToolHandler('update_webhook')({ webhookId: 'bad-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to update webhook');
    expect(result.content[0].text).toContain('Not found');
  });
});

describe('test_webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns success with status code', async () => {
    mockClient.testWebhook.mockResolvedValue({ success: true, statusCode: 200, message: 'OK' });

    const result = await getToolHandler('test_webhook')({ webhookId: 'wh-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✅ Webhook test sent successfully');
    expect(result.content[0].text).toContain('wh-1');
    expect(result.content[0].text).toContain('200');
    expect(result.content[0].text).toContain('OK');
    expect(mockClient.testWebhook).toHaveBeenCalledWith('wh-1');
  });

  it('returns failure when success is false', async () => {
    mockClient.testWebhook.mockResolvedValue({ success: false, error: 'Connection refused' });

    const result = await getToolHandler('test_webhook')({ webhookId: 'wh-bad' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('❌ Webhook test failed');
    expect(result.content[0].text).toContain('Connection refused');
  });

  it('returns error on SDK failure', async () => {
    mockClient.testWebhook.mockRejectedValue(new Error('Webhook not found'));

    const result = await getToolHandler('test_webhook')({ webhookId: 'ghost' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to test webhook');
    expect(result.content[0].text).toContain('Webhook not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════════════════

describe('get_post_logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted post log entries', async () => {
    mockClient.getPostLogs.mockResolvedValue({ data: [
      { platform: 'twitter', timestamp: '2024-06-01T10:00:00Z', status: 'published', message: 'Post went live' },
      { platform: 'instagram', timestamp: '2024-06-01T10:01:00Z', status: 'failed', error: 'Token expired' },
    ] });

    const result = await getToolHandler('get_post_logs')({ postId: 'post-123' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Post Logs: post-123 (2 entries)');
    expect(result.content[0].text).toContain('published');
    expect(result.content[0].text).toContain('Post went live');
    expect(result.content[0].text).toContain('failed');
    expect(result.content[0].text).toContain('Error: Token expired');
    expect(mockClient.getPostLogs).toHaveBeenCalledWith('post-123', { limit: undefined, page: undefined });
  });

  it('returns empty message when no logs', async () => {
    mockClient.getPostLogs.mockResolvedValue({ data: [] });

    const result = await getToolHandler('get_post_logs')({ postId: 'post-empty' });

    expect(result.content[0].text).toContain('No logs found for post post-empty');
  });

  it('returns error on SDK failure', async () => {
    mockClient.getPostLogs.mockRejectedValue(new Error('Post not found'));

    const result = await getToolHandler('get_post_logs')({ postId: 'bad' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get post logs');
    expect(result.content[0].text).toContain('Post not found');
  });
});

describe('list_publishing_logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted publishing log list', async () => {
    mockClient.listPublishingLogs.mockResolvedValue({ data: [
      { platform: 'twitter', timestamp: '2024-06-01T09:00:00Z', status: 'published', action: 'publish', postId: 'p1', message: 'Sent' },
    ] });

    const result = await getToolHandler('list_publishing_logs')({ status: 'published', platform: 'twitter' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Publishing Logs (1 entries)');
    expect(result.content[0].text).toContain('published');
    expect(result.content[0].text).toContain('publish');
    expect(result.content[0].text).toContain('Post: p1');
    expect(result.content[0].text).toContain('Sent');
    expect(mockClient.listPublishingLogs).toHaveBeenCalledWith({
      status: 'published',
      platform: 'twitter',
    });
  });

  it('handles object response with logs array and totalCount', async () => {
    mockClient.listPublishingLogs.mockResolvedValue({ data: [
      { platform: 'instagram', timestamp: '2024-06-02T10:00:00Z', status: 'failed', error: 'Rate limited' },
    ] });

    const result = await getToolHandler('list_publishing_logs')({});

    expect(result.content[0].text).toContain('Publishing Logs (1 entries)');
    expect(result.content[0].text).toContain('Error: Rate limited');
  });

  it('returns empty message when no logs match', async () => {
    mockClient.listPublishingLogs.mockResolvedValue({ data: [] });

    const result = await getToolHandler('list_publishing_logs')({});

    expect(result.content[0].text).toContain('No publishing logs found');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listPublishingLogs.mockRejectedValue(new Error('DB timeout'));

    const result = await getToolHandler('list_publishing_logs')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list publishing logs');
    expect(result.content[0].text).toContain('DB timeout');
  });
});

describe('list_connection_logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted connection log list', async () => {
    mockClient.listConnectionLogs.mockResolvedValue({ data: [
      { platform: 'twitter', timestamp: '2024-06-01T08:00:00Z', status: 'connected', message: 'OAuth success', accountId: 'acc-1' },
    ] });

    const result = await getToolHandler('list_connection_logs')({ platform: 'twitter', status: 'connected' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Connection Logs (1 entries)');
    expect(result.content[0].text).toContain('connected');
    expect(result.content[0].text).toContain('OAuth success');
    expect(result.content[0].text).toContain('Account: acc-1');
    expect(mockClient.listConnectionLogs).toHaveBeenCalledWith({
      platform: 'twitter',
      status: 'connected',
    });
  });

  it('handles object response with logs array and totalCount', async () => {
    mockClient.listConnectionLogs.mockResolvedValue({ data: [
      { platform: 'instagram', timestamp: '2024-06-03T12:00:00Z', status: 'disconnected', error: 'Token revoked', accountId: 'acc-2' },
    ] });

    const result = await getToolHandler('list_connection_logs')({});

    expect(result.content[0].text).toContain('Connection Logs (1 entries)');
    expect(result.content[0].text).toContain('Error: Token revoked');
  });

  it('returns empty message when no logs match', async () => {
    mockClient.listConnectionLogs.mockResolvedValue({ data: [] });

    const result = await getToolHandler('list_connection_logs')({});

    expect(result.content[0].text).toContain('No connection logs found');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listConnectionLogs.mockRejectedValue(new Error('Permission denied'));

    const result = await getToolHandler('list_connection_logs')({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to list connection logs');
    expect(result.content[0].text).toContain('Permission denied');
  });
});
