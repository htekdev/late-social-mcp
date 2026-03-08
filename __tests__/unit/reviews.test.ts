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

await import('../../src/tools/engagement/reviews.js');

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
    reviews: {
      listInboxReviews: vi.fn().mockResolvedValue({ data: [] }),
      replyToInboxReview: vi.fn().mockResolvedValue({ data: {} }),
      deleteInboxReviewReply: vi.fn().mockResolvedValue({ data: {} }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

describe('reviews tools registration', () => {
  it('registers all three review tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('list_reviews');
    expect(names).toContain('reply_to_review');
    expect(names).toContain('delete_review_reply');
  });
});

describe('list_reviews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted review list with star ratings', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { id: 'r1', platform: 'google-business', authorName: 'Jane', rating: 4, message: 'Great service!', createdAt: '2024-06-01' },
      { id: 'r2', platform: 'facebook', authorName: 'John', rating: 2, message: 'Could be better', reply: 'Thanks for the feedback', createdAt: '2024-06-02' },
    ]);

    const handler = getToolHandler('list_reviews');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Reviews');
    expect(result.content[0].text).toContain('Jane');
    expect(result.content[0].text).toContain('★★★★☆');
    expect(result.content[0].text).toContain('(4/5)');
    expect(result.content[0].text).toContain('Great service!');
    expect(result.content[0].text).toContain('★★☆☆☆');
    expect(result.content[0].text).toContain('Thanks for the feedback');
    expect(result.content[0].text).toContain('Total reviews: 2');
  });

  it('returns empty message when no reviews', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_reviews');
    const result = await handler({});

    expect(result.content[0].text).toContain('No reviews found');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('API error'); });

    const handler = getToolHandler('list_reviews');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API error');
  });
});

describe('reply_to_review', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends reply and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({ id: 'reply-1' });

    const handler = getToolHandler('reply_to_review');
    const result = await handler({ reviewId: 'r1', accountId: 'a1', message: 'Thank you!' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Review Reply Sent');
    expect(result.content[0].text).toContain('r1');
    expect(result.content[0].text).toContain('Thank you!');
    expect(result.content[0].text).toContain('reply-1');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Review not found'); });

    const handler = getToolHandler('reply_to_review');
    const result = await handler({ reviewId: 'bad', accountId: 'a1', message: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Review not found');
  });
});

describe('delete_review_reply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes review reply and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('delete_review_reply');
    const result = await handler({ reviewReplyId: 'rr1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Review Reply Deleted');
    expect(result.content[0].text).toContain('rr1');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Permission denied'); });

    const handler = getToolHandler('delete_review_reply');
    const result = await handler({ reviewReplyId: 'bad', accountId: 'a1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Permission denied');
  });
});
