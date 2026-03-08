import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

import { server } from '../../src/server.js';
import { getClient, unwrap } from '../../src/client/lateClient.js';

await import('../../src/tools/engagement/comments.js');

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
    comments: {
      listInboxComments: vi.fn().mockResolvedValue({ data: [] }),
      getInboxPostComments: vi.fn().mockResolvedValue({ data: [] }),
      replyToInboxPost: vi.fn().mockResolvedValue({ data: {} }),
      deleteInboxComment: vi.fn().mockResolvedValue({ data: {} }),
      hideInboxComment: vi.fn().mockResolvedValue({ data: {} }),
      likeInboxComment: vi.fn().mockResolvedValue({ data: {} }),
      sendPrivateReplyToComment: vi.fn().mockResolvedValue({ data: {} }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

describe('comments tools registration', () => {
  it('registers all seven comment tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('list_commented_posts');
    expect(names).toContain('get_post_comments');
    expect(names).toContain('reply_to_comment');
    expect(names).toContain('delete_comment');
    expect(names).toContain('hide_comment');
    expect(names).toContain('like_comment');
    expect(names).toContain('send_private_reply');
  });
});

describe('list_commented_posts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted list of commented posts', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { postId: 'p1', platform: 'instagram', content: 'Check this out', commentCount: 5 },
    ]);

    const handler = getToolHandler('list_commented_posts');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Commented Posts');
    expect(result.content[0].text).toContain('p1');
    expect(result.content[0].text).toContain('5');
  });

  it('returns empty message when no posts', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_commented_posts');
    const result = await handler({});

    expect(result.content[0].text).toContain('No commented posts found');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Server error'); });

    const handler = getToolHandler('list_commented_posts');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Server error');
  });
});

describe('get_post_comments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted comments', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { id: 'cm1', authorName: 'Alice', message: 'Great post!', createdAt: '2024-06-01', likes: 3, replyCount: 1 },
      { id: 'cm2', authorName: 'Bob', message: 'Nice!', createdAt: '2024-06-02', likes: 0 },
    ]);

    const handler = getToolHandler('get_post_comments');
    const result = await handler({ postId: 'p1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Comments on Post p1');
    expect(result.content[0].text).toContain('Alice');
    expect(result.content[0].text).toContain('Great post!');
    expect(result.content[0].text).toContain('Total comments: 2');
  });

  it('returns empty when no comments', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('get_post_comments');
    const result = await handler({ postId: 'p1' });

    expect(result.content[0].text).toContain('No comments found');
  });
});

describe('reply_to_comment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends reply and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'reply-1' });

    const handler = getToolHandler('reply_to_comment');
    const result = await handler({
      postId: 'p1', accountId: 'a1', commentId: 'cm1', message: 'Thanks!',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Reply Sent');
    expect(result.content[0].text).toContain('cm1');
    expect(result.content[0].text).toContain('Thanks!');
    expect(result.content[0].text).toContain('reply-1');
  });
});

describe('delete_comment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes comment and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('delete_comment');
    const result = await handler({ commentId: 'cm1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Comment Deleted');
    expect(result.content[0].text).toContain('cm1');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Not found'); });

    const handler = getToolHandler('delete_comment');
    const result = await handler({ commentId: 'bad', accountId: 'a1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Not found');
  });
});

describe('hide_comment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides comment and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('hide_comment');
    const result = await handler({ commentId: 'cm1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Comment Hidden');
    expect(result.content[0].text).toContain('cm1');
  });
});

describe('like_comment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('likes comment and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('like_comment');
    const result = await handler({ commentId: 'cm1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Comment Liked');
    expect(result.content[0].text).toContain('cm1');
  });
});

describe('send_private_reply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends private reply and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'pr-1' });

    const handler = getToolHandler('send_private_reply');
    const result = await handler({ commentId: 'cm1', accountId: 'a1', message: 'DM reply' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Private Reply Sent');
    expect(result.content[0].text).toContain('DM reply');
    expect(result.content[0].text).toContain('pr-1');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Forbidden'); });

    const handler = getToolHandler('send_private_reply');
    const result = await handler({ commentId: 'cm1', accountId: 'a1', message: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden');
  });
});
