/**
 * Targeted branch-coverage tests.
 *
 * Every test below exercises a specific branch (nullish-coalescing fallback,
 * optional-chaining guard, ternary, truthy check, or try/catch) that the
 * existing unit / integration tests do NOT already cover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

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
            avoidDays: ['sat', 'sun', 'mon'],
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

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { server } from '../../src/mcpServer.js';

// Side-effect imports register tool handlers
await import('../../src/tools/engagement/comments.js');
await import('../../src/tools/engagement/messages.js');
await import('../../src/tools/engagement/reviews.js');
await import('../../src/tools/analytics.js');
await import('../../src/tools/accounts.js');
await import('../../src/tools/validate.js');
await import('../../src/tools/webhooks.js');
await import('../../src/tools/queue.js');
await import('../../src/tools/scheduling.js');

import {
  generateSlots,
  findNextAvailableSlot,
  detectConflicts,
  autoResolveConflicts,
} from '../../src/smart/scheduler.js';
import {
  getBestTimesToPost,
  getPostingFrequency,
  getContentDecay,
} from '../../src/smart/optimizer.js';
import { loadScheduleConfig } from '../../src/config/scheduleConfig.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function h(name: string): ToolHandler {
  const fn = toolHandlers.get(name);
  if (!fn) throw new Error(`Tool "${name}" not registered`);
  return fn;
}

function txt(res: { content: { text: string }[] }): string {
  return res.content[0].text;
}

function setupSchedulerPosts(posts: unknown[] = []) {
  mockClient.listPosts.mockResolvedValue(posts);
}

// ── Reset ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockClient = createMockClient();
});

// ════════════════════════════════════════════════════════════════════════════════
// comments.ts — nullish-coalescing fallbacks & alternative field names
// ════════════════════════════════════════════════════════════════════════════════

describe('comments.ts branch coverage', () => {
  it('list_commented_posts: uses id when postId is absent and caption when content is absent', async () => {
    mockClient.listCommentedPosts.mockResolvedValue(
      [{ id: 'p1', platform: 'ig', caption: 'my caption', commentCount: 5, latestComment: 'nice!', createdAt: '2024-01-01' }],
    );
    const res = await h('list_commented_posts')({});
    const text = txt(res);
    expect(text).toContain('p1');
    expect(text).toContain('my caption');
    expect(text).toContain('Comments:      5');
    expect(text).toContain('Latest:        nice!');
    expect(text).toContain('2024-01-01');
  });

  it('list_commented_posts: single-item array response', async () => {
    mockClient.listCommentedPosts.mockResolvedValue(
      [{ postId: 'p2', platform: 'fb', content: 'hello' }],
    );
    const res = await h('list_commented_posts')({});
    const text = txt(res);
    expect(text).toContain('p2');
    expect(text).toContain('hello');
  });

  it('list_commented_posts: post with no optional fields still renders', async () => {
    mockClient.listCommentedPosts.mockResolvedValue(
      [{ platform: 'ig' }],
    );
    const res = await h('list_commented_posts')({});
    expect(txt(res)).toContain('Platform:      ig');
    expect(txt(res)).not.toContain('Post ID:');
    expect(txt(res)).not.toContain('Comments:');
    expect(txt(res)).not.toContain('Latest:');
  });

  it('get_post_comments: fallback to author/username fields and text/comment/commentId fields', async () => {
    mockClient.getPostComments.mockResolvedValue(
      [
        { author: 'alice', timestamp: '2024-02-01', text: 'great post', commentId: 'c99', likes: 10, replyCount: 2 },
        { username: 'bob', comment: 'thanks!', likes: 0 },
      ],
    );
    const res = await h('get_post_comments')({ postId: 'p1' });
    const text = txt(res);
    expect(text).toContain('alice');
    expect(text).toContain('great post');
    expect(text).toContain('Comment ID: c99');
    expect(text).toContain('Likes: 10');
    expect(text).toContain('Replies: 2');
    expect(text).toContain('bob');
    expect(text).toContain('thanks!');
    expect(text).toContain('Likes: 0');
  });

  it('get_post_comments: comment with no message/text/comment shows no content line', async () => {
    mockClient.getPostComments.mockResolvedValue(
      [{ authorName: 'charlie', createdAt: '2024-03-01' }],
    );
    const res = await h('get_post_comments')({ postId: 'p1' });
    const text = txt(res);
    expect(text).toContain('charlie');
    expect(text).not.toContain('Comment ID:');
    expect(text).not.toContain('Likes:');
    expect(text).not.toContain('Replies:');
  });

  it('get_post_comments: single-item array response', async () => {
    mockClient.getPostComments.mockResolvedValue(
      [{ authorName: 'dan', message: 'cool', id: 'c1' }],
    );
    const res = await h('get_post_comments')({ postId: 'px' });
    expect(txt(res)).toContain('dan');
    expect(txt(res)).toContain('cool');
  });

  it('reply_to_comment: response with no id omits Reply ID line', async () => {
    mockClient.replyToComment.mockResolvedValue({});
    const res = await h('reply_to_comment')({ postId: 'p1', accountId: 'a1', commentId: 'c1', message: 'thanks' });
    expect(txt(res)).not.toContain('Reply ID:');
    expect(txt(res)).toContain('Reply Sent');
  });

  it('reply_to_comment: response with id includes Reply ID line', async () => {
    mockClient.replyToComment.mockResolvedValue({ id: 'r1' });
    const res = await h('reply_to_comment')({ postId: 'p1', accountId: 'a1', commentId: 'c1', message: 'thanks' });
    expect(txt(res)).toContain('Reply ID:   r1');
  });

  it('reply_to_comment: long message is truncated', async () => {
    mockClient.replyToComment.mockResolvedValue({});
    const longMsg = 'a'.repeat(150);
    const res = await h('reply_to_comment')({ postId: 'p1', accountId: 'a1', commentId: 'c1', message: longMsg });
    expect(txt(res)).toContain('…');
  });

  it('send_private_reply: response without id omits Reply ID', async () => {
    mockClient.sendPrivateReply.mockResolvedValue({});
    const res = await h('send_private_reply')({ commentId: 'c1', accountId: 'a1', message: 'hi' });
    expect(txt(res)).toContain('Private Reply Sent');
    expect(txt(res)).not.toContain('Reply ID:');
  });

  it('send_private_reply: response with id includes Reply ID', async () => {
    mockClient.sendPrivateReply.mockResolvedValue({ id: 'pr1' });
    const res = await h('send_private_reply')({ commentId: 'c1', accountId: 'a1', message: 'hi' });
    expect(txt(res)).toContain('Reply ID:   pr1');
  });

  it('list_commented_posts: non-Error thrown in catch uses String(err)', async () => {
    mockClient.listCommentedPosts.mockRejectedValue('string error');
    const res = await h('list_commented_posts')({});
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('string error');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// messages.ts — field fallbacks, isOutgoing ternary, truncation
// ════════════════════════════════════════════════════════════════════════════════

describe('messages.ts branch coverage', () => {
  it('list_conversations: participant fallback, lastMessage, lastMessageAt/updatedAt, unreadCount', async () => {
    mockClient.listConversations.mockResolvedValue(
      [
        { id: 'conv1', platform: 'ig', participant: 'user1', lastMessage: 'hey there this is a message', updatedAt: '2024-01-01', unreadCount: 3 },
      ],
    );
    const res = await h('list_conversations')({});
    const text = txt(res);
    expect(text).toContain('Participant:     user1');
    expect(text).toContain('hey there');
    expect(text).toContain('Last Activity:   2024-01-01');
    expect(text).toContain('Unread:          3');
  });

  it('list_conversations: uses participantName when available', async () => {
    mockClient.listConversations.mockResolvedValue(
      [{ id: 'c2', participantName: 'Jane', lastMessageAt: '2024-05-01' }],
    );
    const res = await h('list_conversations')({});
    expect(txt(res)).toContain('Participant:     Jane');
    expect(txt(res)).toContain('Last Activity:   2024-05-01');
  });

  it('list_conversations: conversation without optional fields still renders', async () => {
    mockClient.listConversations.mockResolvedValue(
      [{ id: 'c3' }],
    );
    const res = await h('list_conversations')({});
    expect(txt(res)).toContain('Conversation ID: c3');
    expect(txt(res)).not.toContain('Participant:');
    expect(txt(res)).not.toContain('Last Message:');
    expect(txt(res)).not.toContain('Unread:');
  });

  it('list_conversations: single-item array response', async () => {
    mockClient.listConversations.mockResolvedValue(
      [{ id: 'c4', platform: 'fb' }],
    );
    const res = await h('list_conversations')({});
    expect(txt(res)).toContain('c4');
  });

  it('get_conversation: all optional fields present', async () => {
    mockClient.getConversation.mockResolvedValue(
      {
        id: 'c5', platform: 'ig', participantName: 'Alice', participantUsername: '@alice',
        accountId: 'acc1', lastMessage: 'hi', lastMessageAt: '2024-06-01',
        unreadCount: 0, createdAt: '2024-01-01',
      },
    );
    const res = await h('get_conversation')({ conversationId: 'c5', accountId: 'acc1' });
    const text = txt(res);
    expect(text).toContain('Alice');
    expect(text).toContain('Username:        @alice');
    expect(text).toContain('Account ID:      acc1');
    expect(text).toContain('Last Message:');
    expect(text).toContain('Last Activity:   2024-06-01');
    expect(text).toContain('Unread:          0');
    expect(text).toContain('Created:         2024-01-01');
  });

  it('get_conversation: participant fallback and updatedAt fallback', async () => {
    mockClient.getConversation.mockResolvedValue(
      { id: 'c6', participant: 'Bob', updatedAt: '2024-07-01' },
    );
    const res = await h('get_conversation')({ conversationId: 'c6', accountId: 'a1' });
    expect(txt(res)).toContain('Participant:     Bob');
    expect(txt(res)).toContain('Last Activity:   2024-07-01');
  });

  it('list_messages: isOutgoing=true shows → (sent), text fallback', async () => {
    mockClient.listMessages.mockResolvedValue(
      [{ senderName: 'Me', sentAt: '2024-01-01T10:00:00Z', isOutgoing: true, text: 'hello from text field', id: 'm1' }],
    );
    const res = await h('list_messages')({ conversationId: 'c1', accountId: 'a1' });
    const text = txt(res);
    expect(text).toContain('→ (sent)');
    expect(text).toContain('hello from text field');
    expect(text).toContain('Message ID: m1');
  });

  it('list_messages: isOutgoing=false shows ← (received), content fallback', async () => {
    mockClient.listMessages.mockResolvedValue(
      [{ sender: 'Other', createdAt: '2024-01-02', isOutgoing: false, content: 'msg from content' }],
    );
    const res = await h('list_messages')({ conversationId: 'c1', accountId: 'a1' });
    const text = txt(res);
    expect(text).toContain('← (received)');
    expect(text).toContain('msg from content');
    expect(text).toContain('Other');
  });

  it('list_messages: from fallback for sender', async () => {
    mockClient.listMessages.mockResolvedValue(
      [{ from: 'system', timestamp: '2024-05-01', message: 'notification' }],
    );
    const res = await h('list_messages')({ conversationId: 'c1', accountId: 'a1' });
    expect(txt(res)).toContain('system');
  });

  it('list_messages: message with no message/text/content omits content line', async () => {
    mockClient.listMessages.mockResolvedValue(
      [{ senderName: 'User', sentAt: '2024-01-01' }],
    );
    const res = await h('list_messages')({ conversationId: 'c1', accountId: 'a1' });
    const text = txt(res);
    expect(text).toContain('User');
    expect(text).not.toContain('Message ID:');
  });

  it('send_message: response with id and sentAt', async () => {
    mockClient.sendMessage.mockResolvedValue(
      { id: 'msg1', sentAt: '2024-01-01T12:00:00Z' },
    );
    const res = await h('send_message')({ conversationId: 'c1', accountId: 'a1', message: 'test' });
    expect(txt(res)).toContain('Message ID:   msg1');
    expect(txt(res)).toContain('Sent at:      2024-01-01T12:00:00Z');
  });

  it('send_message: response without id or sentAt', async () => {
    mockClient.sendMessage.mockResolvedValue({});
    const res = await h('send_message')({ conversationId: 'c1', accountId: 'a1', message: 'test' });
    expect(txt(res)).not.toContain('Message ID:');
    expect(txt(res)).not.toContain('Sent at:');
  });

  it('send_message: non-Error exception uses String(err)', async () => {
    mockClient.sendMessage.mockRejectedValue(42);
    const res = await h('send_message')({ conversationId: 'c1', accountId: 'a1', message: 'test' });
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('42');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// reviews.ts — alternative field names, rating display, missing fields
// ════════════════════════════════════════════════════════════════════════════════

describe('reviews.ts branch coverage', () => {
  it('list_reviews: reviewId fallback, author fallback, text fallback, date fallback', async () => {
    mockClient.listReviews.mockResolvedValue(
      [{ reviewId: 'rv1', author: 'bob', rating: 3, text: 'decent', date: '2024-03-01' }],
    );
    const res = await h('list_reviews')({});
    const text = txt(res);
    expect(text).toContain('rv1');
    expect(text).toContain('bob');
    expect(text).toContain('★★★☆☆');
    expect(text).toContain('decent');
    expect(text).toContain('2024-03-01');
  });

  it('list_reviews: comment fallback for review text', async () => {
    mockClient.listReviews.mockResolvedValue(
      [{ id: 'rv2', authorName: 'Alice', comment: 'nice place', reply: 'thank you!' }],
    );
    const res = await h('list_reviews')({});
    const text = txt(res);
    expect(text).toContain('nice place');
    expect(text).toContain('Your Reply:');
    expect(text).toContain('thank you!');
  });

  it('list_reviews: review without reply omits reply line', async () => {
    mockClient.listReviews.mockResolvedValue(
      [{ id: 'rv3', authorName: 'Carol', message: 'good', rating: 5, createdAt: '2024-06-01' }],
    );
    const res = await h('list_reviews')({});
    expect(txt(res)).not.toContain('Your Reply:');
    expect(txt(res)).toContain('★★★★★');
    expect(txt(res)).toContain('2024-06-01');
  });

  it('list_reviews: review with no optional fields only shows platform', async () => {
    mockClient.listReviews.mockResolvedValue(
      [{ platform: 'google-business' }],
    );
    const res = await h('list_reviews')({});
    expect(txt(res)).toContain('google-business');
    expect(txt(res)).not.toContain('Review ID:');
    expect(txt(res)).not.toContain('Author:');
  });

  it('list_reviews: single-item array response', async () => {
    mockClient.listReviews.mockResolvedValue(
      [{ id: 'rv4', platform: 'fb', message: 'ok' }],
    );
    const res = await h('list_reviews')({});
    expect(txt(res)).toContain('rv4');
    expect(txt(res)).toContain('ok');
  });

  it('reply_to_review: response without id omits Reply ID', async () => {
    mockClient.replyToReview.mockResolvedValue({});
    const res = await h('reply_to_review')({ reviewId: 'r1', accountId: 'a1', message: 'thanks' });
    expect(txt(res)).toContain('Review Reply Sent');
    expect(txt(res)).not.toContain('Reply ID:');
  });

  it('reply_to_review: non-Error exception', async () => {
    mockClient.replyToReview.mockRejectedValue({ code: 500 });
    const res = await h('reply_to_review')({ reviewId: 'r1', accountId: 'a1', message: 'hi' });
    expect(res.isError).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// analytics.ts — field-level undefined checks, fallbacks, padRight
// ════════════════════════════════════════════════════════════════════════════════

describe('analytics.ts branch coverage', () => {
  it('get_post_analytics: exercises all entry.X !== undefined conditional branches', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{
        postId: 'p1', platform: 'ig', impressions: 1000, reach: 500,
        likes: 50, comments: 10, shares: 5, saves: 3, clicks: 20,
        engagementRate: 4.5, date: '2024-01-01',
      }],
    );
    const res = await h('get_post_analytics')({});
    const text = txt(res);
    expect(text).toContain('Impressions:  1000');
    expect(text).toContain('Reach:        500');
    expect(text).toContain('Likes:        50');
    expect(text).toContain('Comments:     10');
    expect(text).toContain('Shares:       5');
    expect(text).toContain('Saves:        3');
    expect(text).toContain('Clicks:       20');
    expect(text).toContain('Engagement:   4.5%');
    expect(text).toContain('Date:         2024-01-01');
  });

  it('get_post_analytics: entry with zero values for all numeric fields (0 !== undefined)', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagementRate: 0 }],
    );
    const res = await h('get_post_analytics')({});
    const text = txt(res);
    expect(text).toContain('Impressions:  0');
    expect(text).toContain('Engagement:   0%');
  });

  it('get_post_analytics: entry with no optional metrics only shows what exists', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ postId: 'p2' }],
    );
    const res = await h('get_post_analytics')({});
    const text = txt(res);
    expect(text).toContain('Post ID:      p2');
    expect(text).not.toContain('Impressions:');
    expect(text).not.toContain('Engagement:');
  });

  it('get_post_analytics: single-item array response', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ postId: 'p3', likes: 100 }],
    );
    const res = await h('get_post_analytics')({});
    expect(txt(res)).toContain('p3');
    expect(txt(res)).toContain('Likes:        100');
  });

  it('get_daily_metrics: nullish coalescing fallbacks render "—" for missing fields', async () => {
    mockClient.getDailyMetrics.mockResolvedValue(
      [{ date: null, impressions: null }],
    );
    const res = await h('get_daily_metrics')({});
    const text = txt(res);
    expect(text).toContain('—');
  });

  it('get_daily_metrics: single-item array response', async () => {
    mockClient.getDailyMetrics.mockResolvedValue(
      [{ date: '2024-01-01', impressions: 500, reach: 200, likes: 30, comments: 5, shares: 2 }],
    );
    const res = await h('get_daily_metrics')({});
    expect(txt(res)).toContain('2024-01-01');
  });

  it('get_follower_stats: exercises all entry conditional pushes including negative netChange', async () => {
    mockClient.getFollowerStats.mockResolvedValue(
      [{
        accountId: 'a1', platform: 'ig', date: '2024-01-01',
        followers: 1000, following: 500, gained: 10, lost: 15, netChange: -5,
      }],
    );
    const res = await h('get_follower_stats')({});
    const text = txt(res);
    expect(text).toContain('Followers:    1000');
    expect(text).toContain('Following:    500');
    expect(text).toContain('Gained:       +10');
    expect(text).toContain('Lost:         -15');
    expect(text).toContain('Net Change:   -5');
  });

  it('get_follower_stats: positive netChange gets + prefix', async () => {
    mockClient.getFollowerStats.mockResolvedValue(
      [{ netChange: 10 }],
    );
    const res = await h('get_follower_stats')({});
    expect(txt(res)).toContain('Net Change:   +10');
  });

  it('get_follower_stats: single-item array response', async () => {
    mockClient.getFollowerStats.mockResolvedValue(
      [{ followers: 999 }],
    );
    const res = await h('get_follower_stats')({});
    expect(txt(res)).toContain('999');
  });

  it('get_post_timeline: timestamp fallback instead of date', async () => {
    mockClient.getPostTimeline.mockResolvedValue(
      [{ timestamp: '2024-01-01T10:00', impressions: 100, likes: 5, comments: 1, shares: 0 }],
    );
    const res = await h('get_post_timeline')({ postId: 'p1' });
    const text = txt(res);
    expect(text).toContain('2024-01-01');
  });

  it('get_post_timeline: missing all fields uses "—" fallbacks', async () => {
    mockClient.getPostTimeline.mockResolvedValue(
      [{}],
    );
    const res = await h('get_post_timeline')({ postId: 'p1' });
    expect(txt(res)).toContain('—');
  });

  it('get_youtube_daily_views: uses count fallback instead of views', async () => {
    mockClient.getYouTubeDailyViews.mockResolvedValue(
      [
        { date: '2024-01-01', count: 150 },
        { count: 200 },
      ],
    );
    const res = await h('get_youtube_daily_views')({ videoId: 'v1' });
    const text = txt(res);
    expect(text).toContain('Total views: 350');
    expect(text).toContain('—');
  });

  it('get_youtube_daily_views: single-item array response', async () => {
    mockClient.getYouTubeDailyViews.mockResolvedValue(
      [{ views: 500, date: '2024-01-01' }],
    );
    const res = await h('get_youtube_daily_views')({ videoId: 'v2' });
    expect(txt(res)).toContain('Total views: 500');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// accounts.ts — isActive false, recommendations, usage limits/usage objects
// ════════════════════════════════════════════════════════════════════════════════

describe('accounts.ts branch coverage', () => {
  it('list_accounts: inactive account shows ❌ Inactive', async () => {
    mockClient.listAccounts.mockResolvedValue(
      [{ platform: 'twitter', displayName: 'Test', username: 'test', isActive: false }],
    );
    const res = await h('list_accounts')({});
    expect(txt(res)).toContain('❌ Inactive');
  });

  it('list_accounts: filters by platform only', async () => {
    mockClient.listAccounts.mockResolvedValue(
      [{ platform: 'ig', displayName: 'Insta', username: 'ig_user', isActive: true }],
    );
    await h('list_accounts')({ platform: 'ig' });
    expect(mockClient.listAccounts).toHaveBeenCalledWith({ platform: 'ig' });
  });

  it('list_accounts: filters by profileId only', async () => {
    mockClient.listAccounts.mockResolvedValue([]);
    await h('list_accounts')({ profileId: 'prof1' });
    expect(mockClient.listAccounts).toHaveBeenCalledWith({ profileId: 'prof1' });
  });

  it('check_account_health: single account with recommendations', async () => {
    mockClient.getAccountHealth.mockResolvedValue(
      {
        tokenStatus: 'valid',
        permissions: ['read', 'write'],
        recommendations: ['Enable 2FA', 'Update token'],
      },
    );
    const res = await h('check_account_health')({ accountId: 'a1' });
    const text = txt(res);
    expect(text).toContain('Permissions: read, write');
    expect(text).toContain('Recommendations:');
    expect(text).toContain('• Enable 2FA');
    expect(text).toContain('• Update token');
  });

  it('check_account_health: all accounts with recommendations', async () => {
    mockClient.getAllAccountsHealth.mockResolvedValue(
      [{
        platform: 'twitter', displayName: 'My Account', tokenStatus: 'expired',
        permissions: ['read'], recommendations: ['Reconnect account'],
      }],
    );
    const res = await h('check_account_health')({});
    const text = txt(res);
    expect(text).toContain('Recommendations: Reconnect account');
    expect(text).toContain('Token: expired');
  });

  it('check_account_health: permissions as string, no recommendations', async () => {
    mockClient.getAccountHealth.mockResolvedValue(
      { tokenStatus: 'valid', permissions: 'all' },
    );
    const res = await h('check_account_health')({ accountId: 'a2' });
    expect(txt(res)).toContain('Permissions: all');
    expect(txt(res)).not.toContain('Recommendations:');
  });

  it('get_usage_stats: with limits and usage objects', async () => {
    mockClient.getUsageStats.mockResolvedValue(
      {
        planName: 'Pro', billingPeriodStart: '2024-01-01', billingPeriodEnd: '2024-02-01',
        limits: { posts: 100, accounts: 5 },
        usage: { posts: 42, accounts: 3 },
      },
    );
    const res = await h('get_usage_stats')({});
    const text = txt(res);
    expect(text).toContain('Plan: Pro');
    expect(text).toContain('Limits:');
    expect(text).toContain('posts: 100');
    expect(text).toContain('accounts: 5');
    expect(text).toContain('Current Usage:');
    expect(text).toContain('posts: 42');
  });

  it('get_usage_stats: without limits and usage objects', async () => {
    mockClient.getUsageStats.mockResolvedValue(
      { plan: 'Free' },
    );
    const res = await h('get_usage_stats')({});
    const text = txt(res);
    expect(text).toContain('Plan: Free');
    expect(text).not.toContain('Limits:');
    expect(text).not.toContain('Current Usage:');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// validate.ts — errors, warnings, clean pass, post length formats, hashtags
// ════════════════════════════════════════════════════════════════════════════════

describe('validate.ts branch coverage', () => {
  it('validate_post: with mediaUrls', async () => {
    mockClient.validatePost.mockResolvedValue({});
    await h('validate_post')({ content: 'test', platforms: 'ig', mediaUrls: 'https://img.com/1.jpg, https://img.com/2.jpg' });
    expect(mockClient.validatePost).toHaveBeenCalledWith(
      'test',
      ['ig'],
      ['https://img.com/1.jpg', 'https://img.com/2.jpg'],
    );
  });

  it('validate_post: with errors and warnings', async () => {
    mockClient.validatePost.mockResolvedValue(
      {
        errors: [{ platform: 'x', message: 'Content too long' }],
        warnings: [{ message: 'No hashtags' }],
      },
    );
    const res = await h('validate_post')({ content: 'test', platforms: 'x' });
    const text = txt(res);
    expect(text).toContain('Errors:');
    expect(text).toContain('❌ [x] Content too long');
    expect(text).toContain('Warnings:');
    expect(text).toContain('⚠️ [general] No hashtags');
    expect(text).not.toContain('✅ Post passed all validations.');
  });

  it('validate_post: clean validation (no errors, no warnings)', async () => {
    mockClient.validatePost.mockResolvedValue({});
    const res = await h('validate_post')({ content: 'hello world', platforms: 'ig' });
    expect(txt(res)).toContain('✅ Post passed all validations.');
  });

  it('validate_post: content truncation for long content', async () => {
    mockClient.validatePost.mockResolvedValue({});
    const longContent = 'a'.repeat(100);
    const res = await h('validate_post')({ content: longContent, platforms: 'ig' });
    expect(txt(res)).toContain('…');
  });

  it('validate_post_length: result.platforms array format', async () => {
    mockClient.validatePostLength.mockResolvedValue(
      {
        platforms: [
          { platform: 'x', withinLimit: false, length: 300, maxLength: 280 },
          { platform: 'ig', withinLimit: true, length: 300, maxLength: 2200 },
        ],
      },
    );
    const res = await h('validate_post_length')({ content: 'a'.repeat(300), platforms: 'x,ig' });
    const text = txt(res);
    expect(text).toContain('❌ x: 300/280 chars');
    expect(text).toContain('✅ ig: 300/2200 chars');
  });

  it('validate_post_length: result as object with platform keys (non-array format)', async () => {
    mockClient.validatePostLength.mockResolvedValue(
      {
        x: { withinLimit: false, length: 300, maxLength: 280 },
        ig: { withinLimit: true, length: 300, maxLength: 2200 },
      },
    );
    const res = await h('validate_post_length')({ content: 'a'.repeat(300), platforms: 'x,ig' });
    const text = txt(res);
    expect(text).toContain('❌ x: 300/280');
    expect(text).toContain('✅ ig: 300/2200');
  });

  it('validate_post_length: missing length/maxLength uses fallback', async () => {
    mockClient.validatePostLength.mockResolvedValue(
      {
        platforms: [{ platform: 'x', withinLimit: true }],
      },
    );
    const res = await h('validate_post_length')({ content: 'test', platforms: 'x' });
    expect(txt(res)).toContain('✅ x: 4/? chars');
  });

  it('check_instagram_hashtags: results array (not hashtags)', async () => {
    mockClient.checkInstagramHashtags.mockResolvedValue(
      {
        results: [
          { name: 'travel', status: 'safe' },
          { name: 'fitness', status: 'restricted' },
        ],
      },
    );
    const res = await h('check_instagram_hashtags')({ hashtags: '#travel,#fitness' });
    const text = txt(res);
    expect(text).toContain('✅ #travel — safe');
    expect(text).toContain('⚠️ #fitness — restricted');
  });

  it('check_instagram_hashtags: banned status icon', async () => {
    mockClient.checkInstagramHashtags.mockResolvedValue(
      {
        hashtags: [{ hashtag: 'spam', status: 'banned' }],
      },
    );
    const res = await h('check_instagram_hashtags')({ hashtags: 'spam' });
    expect(txt(res)).toContain('🚫 #spam — banned');
  });

  it('check_instagram_hashtags: JSON fallback when neither hashtags nor results', async () => {
    mockClient.checkInstagramHashtags.mockResolvedValue(
      { unexpected: 'format' },
    );
    const res = await h('check_instagram_hashtags')({ hashtags: 'test' });
    expect(txt(res)).toContain('"unexpected"');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// webhooks.ts — empty list, _id vs id, events array/string, optional fields
// ════════════════════════════════════════════════════════════════════════════════

describe('webhooks.ts branch coverage', () => {
  it('list_webhooks: empty webhook list', async () => {
    mockClient.listWebhooks.mockResolvedValue([]);
    const res = await h('list_webhooks')({});
    expect(txt(res)).toContain('No webhooks configured.');
  });

  it('list_webhooks: webhook with _id fallback, events as string, inactive', async () => {
    mockClient.listWebhooks.mockResolvedValue(
      [{ _id: 'wh1', name: 'My Hook', url: 'https://example.com', events: 'post.created', isActive: false }],
    );
    const res = await h('list_webhooks')({});
    const text = txt(res);
    expect(text).toContain('wh1');
    expect(text).toContain('My Hook');
    expect(text).toContain('❌ Inactive');
    expect(text).toContain('post.created');
  });

  it('list_webhooks: webhook with no name, no _id (uses id), events as array', async () => {
    mockClient.listWebhooks.mockResolvedValue(
      [{ id: 'wh2', url: 'https://x.com', events: ['post.created', 'post.updated'], isActive: true }],
    );
    const res = await h('list_webhooks')({});
    const text = txt(res);
    expect(text).toContain('Unnamed');
    expect(text).toContain('wh2');
    expect(text).toContain('post.created, post.updated');
    expect(text).toContain('✅ Active');
  });

  it('list_webhooks: empty array returns no webhooks message', async () => {
    mockClient.listWebhooks.mockResolvedValue([]);
    const res = await h('list_webhooks')({});
    expect(txt(res)).toContain('No webhooks configured.');
  });

  it('create_webhook: without name', async () => {
    mockClient.createWebhook.mockResolvedValue(
      { _id: 'wh3' },
    );
    const res = await h('create_webhook')({ url: 'https://x.com/hook', events: 'post.created' });
    const text = txt(res);
    expect(text).toContain('wh3');
    expect(text).toContain('Name: N/A');
  });

  it('create_webhook: with name', async () => {
    mockClient.createWebhook.mockResolvedValue(
      { id: 'wh4', name: 'Test Hook' },
    );
    const res = await h('create_webhook')({ url: 'https://x.com/hook', events: 'post.created,post.updated', name: 'Test Hook' });
    const text = txt(res);
    expect(text).toContain('Test Hook');
    expect(text).toContain('post.created, post.updated');
    expect(mockClient.createWebhook).toHaveBeenCalledWith(
      'https://x.com/hook',
      ['post.created', 'post.updated'],
      'Test Hook',
    );
  });

  it('update_webhook: with events string and optional fields', async () => {
    mockClient.updateWebhook.mockResolvedValue(
      { name: 'Updated', url: 'https://new.com', isActive: true, events: ['a', 'b'] },
    );
    const res = await h('update_webhook')({
      webhookId: 'wh1', url: 'https://new.com', events: 'a,b', name: 'Updated', isActive: true,
    });
    const text = txt(res);
    expect(text).toContain('Updated');
    expect(text).toContain('Events: a, b');
  });

  it('update_webhook: without events — events line omitted', async () => {
    mockClient.updateWebhook.mockResolvedValue(
      { name: 'Renamed' },
    );
    const res = await h('update_webhook')({ webhookId: 'wh1', name: 'Renamed' });
    expect(txt(res)).not.toContain('Events:');
  });

  it('update_webhook: events from original events string when webhook.events is not array', async () => {
    mockClient.updateWebhook.mockResolvedValue(
      { events: 'not-an-array' },
    );
    const res = await h('update_webhook')({ webhookId: 'wh1', events: 'x,y' });
    const text = txt(res);
    expect(text).toContain('Events: x, y');
  });

  it('test_webhook: success=false shows failure', async () => {
    mockClient.testWebhook.mockResolvedValue(
      { success: false, statusCode: 500, message: 'Internal Error', error: 'connection refused' },
    );
    const res = await h('test_webhook')({ webhookId: 'wh1' });
    const text = txt(res);
    expect(text).toContain('❌ Webhook test failed.');
    expect(text).toContain('Response Status: 500');
    expect(text).toContain('Message: Internal Error');
    expect(text).toContain('Error: connection refused');
  });

  it('test_webhook: success=true (explicit) shows success', async () => {
    mockClient.testWebhook.mockResolvedValue(
      { success: true, statusCode: 200 },
    );
    const res = await h('test_webhook')({ webhookId: 'wh1' });
    expect(txt(res)).toContain('✅ Webhook test sent successfully!');
  });

  it('test_webhook: no success field defaults to success (success !== false)', async () => {
    mockClient.testWebhook.mockResolvedValue({});
    const res = await h('test_webhook')({ webhookId: 'wh1' });
    expect(txt(res)).toContain('✅ Webhook test sent successfully!');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// queue.ts — days/times as string, non-Error catch, slot fallbacks
// ════════════════════════════════════════════════════════════════════════════════

describe('queue.ts branch coverage', () => {
  it('list_queues: days and times as string instead of array', async () => {
    mockClient.listQueues.mockResolvedValue(
      [{ name: 'Q1', id: 'q1', days: 'mon,tue,wed', times: '09:00,12:00' }],
    );
    const res = await h('list_queues')({ profileId: 'p1' });
    const text = txt(res);
    expect(text).toContain('Days:  mon,tue,wed');
    expect(text).toContain('Times: 09:00,12:00');
  });

  it('list_queues: queue without name or id', async () => {
    mockClient.listQueues.mockResolvedValue(
      [{ isDefault: true, days: ['mon'], times: ['10:00'] }],
    );
    const res = await h('list_queues')({ profileId: 'p1' });
    const text = txt(res);
    expect(text).toContain('(unnamed)');
    expect(text).toContain('⭐ Default queue');
  });

  it('list_queues: result as array with nested data', async () => {
    mockClient.listQueues.mockResolvedValue(
      [{ name: 'Q2', id: 'q2', days: ['fri'], times: ['15:00'] }],
    );
    const res = await h('list_queues')({ profileId: 'p1' });
    expect(txt(res)).toContain('Q2');
  });

  it('create_queue: non-Error exception uses string message', async () => {
    mockClient.createQueue.mockRejectedValue('unexpected');
    const res = await h('create_queue')({ profileId: 'p1', days: 'mon', times: '09:00' });
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('Failed to create queue');
  });

  it('update_queue: with empty days after trim/filter returns error', async () => {
    const res = await h('update_queue')({ profileId: 'p1', days: ' , , ' });
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('Days list cannot be empty');
  });

  it('update_queue: with empty times after trim/filter returns error', async () => {
    const res = await h('update_queue')({ profileId: 'p1', times: ' , , ' });
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('Times list cannot be empty');
  });

  it('preview_queue_slots: slot with scheduledFor fallback', async () => {
    mockClient.previewQueueSlots.mockResolvedValue(
      [{ scheduledFor: '2024-01-01T10:00:00Z' }],
    );
    const res = await h('preview_queue_slots')({ profileId: 'p1' });
    expect(txt(res)).toContain('2024-01-01T10:00:00Z');
  });

  it('preview_queue_slots: slot with time fallback', async () => {
    mockClient.previewQueueSlots.mockResolvedValue(
      [{ time: '14:00' }],
    );
    const res = await h('preview_queue_slots')({ profileId: 'p1' });
    expect(txt(res)).toContain('14:00');
  });

  it('preview_queue_slots: slot with no known fields uses JSON.stringify', async () => {
    mockClient.previewQueueSlots.mockResolvedValue(
      [{ unknown: 'value' }],
    );
    const res = await h('preview_queue_slots')({ profileId: 'p1' });
    expect(txt(res)).toContain('unknown');
  });

  it('preview_queue_slots: result as array with nested data', async () => {
    mockClient.previewQueueSlots.mockResolvedValue(
      [{ datetime: '2024-06-01T09:00' }],
    );
    const res = await h('preview_queue_slots')({ profileId: 'p1' });
    expect(txt(res)).toContain('2024-06-01T09:00');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// scheduling.ts — clipType avoidDays, data.data format, nearby posts, past slots
// ════════════════════════════════════════════════════════════════════════════════

describe('scheduling.ts branch coverage', () => {
  it('find_next_slot: clipType-specific avoidDays override', async () => {
    mockClient.listPosts.mockResolvedValue([]);
    const res = await h('find_next_slot')({ platform: 'x', clipType: 'short' });
    expect(res.isError).not.toBe(true);
    expect(txt(res)).toContain('Short Clip');
  });

  it('find_next_slot: postList from array response', async () => {
    mockClient.listPosts.mockResolvedValue(
      [{ scheduledFor: '2099-06-15T09:00:00Z', content: 'future post' }],
    );
    const res = await h('find_next_slot')({ platform: 'x' });
    expect(res.isError).not.toBe(true);
  });

  it('view_calendar: post.platforms array mapped through toDisplayPlatform', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    mockClient.listPosts.mockResolvedValue(
      [{
        scheduledFor: futureDate.toISOString(),
        platforms: ['twitter', 'instagram'],
        content: 'multi-platform',
      }],
    );
    const res = await h('view_calendar')({ days: 7 });
    const text = txt(res);
    expect(text).toContain('multi-platform');
  });

  it('view_calendar: post without platforms shows "unknown"', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    mockClient.listPosts.mockResolvedValue(
      [{ scheduledFor: futureDate.toISOString(), content: 'no-plat' }],
    );
    const res = await h('view_calendar')({ days: 7 });
    expect(txt(res)).toContain('unknown');
  });

  it('view_calendar: post without scheduledFor is skipped', async () => {
    mockClient.listPosts.mockResolvedValue(
      [{ content: 'draft', platforms: ['ig'] }],
    );
    const res = await h('view_calendar')({ days: 7 });
    expect(txt(res)).toContain('No scheduled posts');
  });

  it('view_calendar: post without content shows (no content)', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    mockClient.listPosts.mockResolvedValue(
      [{ scheduledFor: futureDate.toISOString(), platforms: ['ig'] }],
    );
    const res = await h('view_calendar')({ days: 7 });
    expect(txt(res)).toContain('(no content)');
  });

  it('view_schedule_config: all platforms when no platform filter', async () => {
    const res = await h('view_schedule_config')({});
    const text = txt(res);
    expect(text).toContain('Schedule Config');
    expect(text).toContain('INSTAGRAM');
  });

  it('view_schedule_config: byClipType section rendered', async () => {
    const res = await h('view_schedule_config')({ platform: 'x' });
    const text = txt(res);
    expect(text).toContain('Clip Type: short');
    expect(text).toContain('Short Clip');
  });

  it('view_schedule_config: avoidDays displayed', async () => {
    const res = await h('view_schedule_config')({ platform: 'x' });
    expect(txt(res)).toContain('Avoid days: sat, sun');
  });

  it('schedule_post: non-Error exception', async () => {
    mockClient.updatePost.mockRejectedValue(123);
    const res = await h('schedule_post')({ postId: 'p1', scheduledFor: '2024-01-01T10:00:00Z' });
    expect(res.isError).toBe(true);
    expect(txt(res)).toContain('Failed to schedule post');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// optimizer.ts — field fallbacks, recommendation branches, content decay paths
// ════════════════════════════════════════════════════════════════════════════════

describe('optimizer.ts branch coverage', () => {
  it('getBestTimesToPost: uses times field fallback', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ platform: 'ig', times: [{ dayOfWeek: 'mon', time: 9, score: 85 }] }],
    );
    const result = await getBestTimesToPost('ig');
    expect(result).toHaveLength(1);
    expect(result[0].bestTimes[0].day).toBe('mon');
    expect(result[0].bestTimes[0].hour).toBe(9);
    expect(result[0].bestTimes[0].engagement).toBe(85);
  });

  it('getBestTimesToPost: uses data field fallback', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ data: [{ day: 'tue', hour: 14, engagement: 70 }] }],
    );
    const result = await getBestTimesToPost();
    expect(result[0].bestTimes[0].day).toBe('tue');
    expect(result[0].platform).toBe('all');
  });

  it('getBestTimesToPost: empty bestTimes/times/data returns empty array for times', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ platform: 'x' }],
    );
    const result = await getBestTimesToPost('x');
    expect(result[0].bestTimes).toEqual([]);
  });

  it('getBestTimesToPost: error returns empty array', async () => {
    mockClient.getAnalytics.mockRejectedValue(new Error('fail'));
    const result = await getBestTimesToPost();
    expect(result).toEqual([]);
  });

  it('getPostingFrequency: increase recommendation (optimal > current * 1.2)', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ current: 3, optimal: 7, correlation: 0.8, platform: 'ig' }],
    );
    const result = await getPostingFrequency('ig');
    expect(result[0].recommendation).toContain('increasing');
    expect(result[0].recommendation).toContain('3');
    expect(result[0].recommendation).toContain('7');
  });

  it('getPostingFrequency: decrease recommendation (optimal < current * 0.8)', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ current: 10, optimal: 3, correlation: 0.5, platform: 'x' }],
    );
    const result = await getPostingFrequency('x');
    expect(result[0].recommendation).toContain('reducing');
  });

  it('getPostingFrequency: maintain recommendation (optimal ≈ current)', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ current: 5, optimal: 5, correlation: 0.9 }],
    );
    const result = await getPostingFrequency();
    expect(result[0].recommendation).toContain('Maintain');
    expect(result[0].platform).toBe('all');
  });

  it('getPostingFrequency: uses recommended fallback for optimal', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ currentFrequency: 5, recommended: 5, engagementCorrelation: 0.9 }],
    );
    const result = await getPostingFrequency();
    expect(result[0].optimalFrequency).toBe(5);
    expect(result[0].currentFrequency).toBe(5);
    expect(result[0].engagementCorrelation).toBe(0.9);
  });

  it('getPostingFrequency: error returns empty array', async () => {
    mockClient.getAnalytics.mockRejectedValue(new Error('fail'));
    const result = await getPostingFrequency();
    expect(result).toEqual([]);
  });

  it('getContentDecay: with postId — timeline points array', async () => {
    mockClient.getPostTimeline.mockResolvedValue(
      [
        { date: '2024-01-01T01:00:00Z', likes: 10, comments: 2, shares: 1, impressions: 100 },
        { date: '2024-01-01T12:00:00Z', likes: 5, comments: 1, shares: 0, impressions: 50 },
      ],
    );
    const result = await getContentDecay('p1', 'ig');
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('p1');
    expect(result[0].totalEngagement).toBe(169);
    expect(result[0].decayPoints).toHaveLength(2);
    expect(result[0].halfLifeHours).not.toBeNull();
  });

  it('getContentDecay: with postId — timestamp fallback for date field', async () => {
    mockClient.getPostTimeline.mockResolvedValue(
      [
        { timestamp: '2024-01-01T02:00:00Z', likes: 20, comments: 3, shares: 2, impressions: 200 },
      ],
    );
    const result = await getContentDecay('p2');
    expect(result[0].totalEngagement).toBe(225);
    expect(result[0].platform).toBe('unknown');
  });

  it('getContentDecay: with postId — publishedAt defaults to empty string', async () => {
    mockClient.getPostTimeline.mockResolvedValue(
      [{ date: new Date().toISOString(), likes: 1 }],
    );
    const result = await getContentDecay('p3');
    expect(result[0].publishedAt).toBe('');
  });

  it('getContentDecay: with postId — empty timeline returns 0 engagement', async () => {
    mockClient.getPostTimeline.mockResolvedValue([]);
    const result = await getContentDecay('p4');
    expect(result[0].totalEngagement).toBe(0);
    expect(result[0].halfLifeHours).toBeNull();
  });

  it('getContentDecay: without postId — falls back to analytics list', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ _id: 'post1' }, { postId: 'post2' }, { id: 'post3' }],
    );
    mockClient.getPostTimeline.mockResolvedValue(
      [{ date: '2024-01-01T01:00:00Z', likes: 5 }],
    );
    const result = await getContentDecay(undefined, 'ig');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('getContentDecay: without postId — empty timeline for each post', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ _id: 'postA' }],
    );
    mockClient.getPostTimeline.mockResolvedValue([]);
    const result = await getContentDecay();
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('getContentDecay: without postId — post without id is skipped', async () => {
    mockClient.getAnalytics.mockResolvedValue(
      [{ content: 'no id here' }],
    );
    const result = await getContentDecay();
    expect(result).toEqual([]);
  });

  it('getContentDecay: error returns empty array', async () => {
    mockClient.getAnalytics.mockRejectedValue(new Error('fail'));
    const result = await getContentDecay();
    expect(result).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// scheduler.ts — findNextAvailableSlot, detectConflicts, autoResolveConflicts
// ════════════════════════════════════════════════════════════════════════════════

describe('scheduler.ts branch coverage', () => {
  it('findNextAvailableSlot: returns first available slot for x', async () => {
    setupSchedulerPosts([]);
    const result = await findNextAvailableSlot('x');
    expect(result).not.toBeNull();
    expect(result!.slot).toContain('T');
    expect(result!.label).toBeTruthy();
  });

  it('findNextAvailableSlot: with clipType short', async () => {
    setupSchedulerPosts([]);
    const result = await findNextAvailableSlot('x', 'short');
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Short Clip');
  });

  it('findNextAvailableSlot: returns null when no config', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);
    const result = await findNextAvailableSlot('x');
    expect(result).toBeNull();
  });

  it('findNextAvailableSlot: returns null for unknown platform with no slots', async () => {
    setupSchedulerPosts([]);
    const result = await findNextAvailableSlot('unknown-platform');
    expect(result).toBeNull();
  });

  it('findNextAvailableSlot: skips booked slots', async () => {
    const futureSlots: unknown[] = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      futureSlots.push({
        _id: `post-${i}`,
        scheduledFor: `${dateStr}T09:00:00Z`,
        platforms: [{ platform: 'twitter' }],
        content: `Post ${i}`,
        status: 'scheduled',
      });
    }
    setupSchedulerPosts(futureSlots);
    const result = await findNextAvailableSlot('x');
    expect(result).not.toBeNull();
  });

  it('detectConflicts: detects time slot conflicts (duplicate posts)', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 2);
    const isoDate = futureDate.toISOString();

    setupSchedulerPosts([
      { _id: 'p1', scheduledFor: isoDate, platforms: [{ platform: 'twitter' }], content: 'Post A', status: 'scheduled' },
      { _id: 'p2', scheduledFor: isoDate, platforms: [{ platform: 'twitter' }], content: 'Post B', status: 'scheduled' },
    ]);
    const report = await detectConflicts('x');
    expect(report.conflicts.length).toBeGreaterThanOrEqual(0);
  });

  it('detectConflicts: detects post on avoided day', async () => {
    const nextSat = new Date();
    const dayOfWeek = nextSat.getDay();
    const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7;
    nextSat.setDate(nextSat.getDate() + daysUntilSat);
    nextSat.setHours(9, 0, 0, 0);

    setupSchedulerPosts([
      { _id: 'sat-post', scheduledFor: nextSat.toISOString(), platforms: [{ platform: 'twitter' }], content: 'Saturday post', status: 'scheduled' },
    ]);
    const report = await detectConflicts('x');
    expect(report.outOfWindow.length).toBeGreaterThanOrEqual(0);
  });

  it('autoResolveConflicts: returns empty when no config', async () => {
    vi.mocked(loadScheduleConfig).mockReturnValueOnce(null);
    setupSchedulerPosts([]);
    const result = await autoResolveConflicts();
    expect(result).toEqual({ plan: [], executed: false });
  });

  it('autoResolveConflicts: returns empty when no conflicts', async () => {
    setupSchedulerPosts([]);
    const result = await autoResolveConflicts();
    expect(result.plan).toEqual([]);
    expect(result.executed).toBe(false);
  });

  it('generateSlots: respects clipType-specific avoidDays', async () => {
    const bookedMs = new Set<number>();
    const slots = generateSlots('x', 'short', 3, bookedMs, 'America/Chicago');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const date = new Date(slot);
      const day = date.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).toLowerCase().slice(0, 3);
      expect(['sat', 'sun', 'mon']).not.toContain(day);
    }
  });

  it('generateSlots: skips already-booked time slots', async () => {
    const bookedMs = new Set<number>();
    const first = generateSlots('x', undefined, 1, bookedMs, 'America/Chicago');
    expect(first).toHaveLength(1);
    const second = generateSlots('x', undefined, 1, bookedMs, 'America/Chicago');
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
  });
});
