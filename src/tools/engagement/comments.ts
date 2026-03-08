import { server } from '../../mcpServer.js';
import { getClient, unwrap, toApiPlatform } from '../../client/lateClient.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { z } from 'zod';

// ── list_commented_posts ────────────────────────────────────────────────────

server.tool(
  'list_commented_posts',
  'List posts that have received comments in the inbox',
  {
    profileId: z.string().optional().describe('Filter by profile ID'),
    platform: z.string().optional().describe('Filter by platform (e.g. instagram, facebook)'),
    limit: z.number().optional().describe('Max results to return'),
  },
  async ({ profileId, platform, limit }) => {
    try {
      const late = getClient().sdk;
      const data = unwrap(
        await late.comments.listInboxComments({
          query: {
            profileId,
            platform: platform ? toApiPlatform(platform) : undefined,
            limit,
          },
        }),
      );

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return textResponse('No commented posts found.');
      }

      const items = Array.isArray(data) ? data : [data];
      const lines: string[] = ['💬 Commented Posts', '═'.repeat(60)];

      for (const item of items) {
        const p = item as Record<string, unknown>;
        lines.push('');
        if (p.postId ?? p.id) lines.push(`Post ID:       ${p.postId ?? p.id}`);
        if (p.platform) lines.push(`Platform:      ${p.platform}`);
        if (p.content ?? p.caption) lines.push(`Content:       ${truncate(String(p.content ?? p.caption), 80)}`);
        if (p.commentCount !== undefined) lines.push(`Comments:      ${p.commentCount}`);
        if (p.latestComment) lines.push(`Latest:        ${truncate(String(p.latestComment), 60)}`);
        if (p.publishedAt ?? p.createdAt) lines.push(`Published:     ${p.publishedAt ?? p.createdAt}`);
        lines.push('─'.repeat(60));
      }

      lines.push(`\nTotal posts with comments: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to list commented posts: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_post_comments ───────────────────────────────────────────────────────

server.tool(
  'get_post_comments',
  'Get comments on a specific post',
  {
    postId: z.string().describe('The post ID to get comments for'),
    accountId: z.string().optional().describe('Filter by account ID'),
    limit: z.number().optional().describe('Max comments to return'),
  },
  async ({ postId, accountId, limit }) => {
    try {
      const late = getClient().sdk;
      const data = unwrap(
        await late.comments.getInboxPostComments({
          path: { postId },
          query: { accountId, limit },
        }),
      );

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return textResponse(`No comments found for post ${postId}.`);
      }

      const items = Array.isArray(data) ? data : [data];
      const lines: string[] = [
        `💬 Comments on Post ${postId}`,
        '═'.repeat(60),
      ];

      for (const item of items) {
        const c = item as Record<string, unknown>;
        const author = c.authorName ?? c.author ?? c.username ?? 'Unknown';
        const timestamp = c.createdAt ?? c.timestamp ?? '';

        lines.push('');
        lines.push(`[${timestamp}] ${author}`);
        if (c.message ?? c.text ?? c.comment) {
          lines.push(`  ${c.message ?? c.text ?? c.comment}`);
        }
        if (c.id ?? c.commentId) lines.push(`  Comment ID: ${c.id ?? c.commentId}`);
        if (c.likes !== undefined) lines.push(`  Likes: ${c.likes}`);
        if (c.replyCount !== undefined) lines.push(`  Replies: ${c.replyCount}`);
        lines.push('─'.repeat(60));
      }

      lines.push(`\nTotal comments: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get post comments: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── reply_to_comment ────────────────────────────────────────────────────────

server.tool(
  'reply_to_comment',
  'Reply to a comment on a post',
  {
    postId: z.string().describe('The post ID the comment is on'),
    accountId: z.string().describe('The account ID to reply from'),
    commentId: z.string().describe('The comment ID to reply to'),
    message: z.string().describe('The reply message text'),
  },
  async ({ postId, accountId, commentId, message }) => {
    try {
      const late = getClient().sdk;
      const data = unwrap(
        await late.comments.replyToInboxPost({
          path: { postId },
          body: { accountId, commentId, message },
        }),
      );

      const result = data as Record<string, unknown> | undefined;
      const lines: string[] = [
        '✅ Reply Sent',
        '═'.repeat(45),
        `Post ID:    ${postId}`,
        `Comment ID: ${commentId}`,
        `Account:    ${accountId}`,
        `Reply:      ${truncate(message, 100)}`,
      ];

      if (result?.id) lines.push(`Reply ID:   ${result.id}`);

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to reply to comment: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── delete_comment ──────────────────────────────────────────────────────────

server.tool(
  'delete_comment',
  'Delete a comment from the inbox',
  {
    commentId: z.string().describe('The comment ID to delete'),
    accountId: z.string().describe('The account ID that owns the comment'),
  },
  async ({ commentId, accountId }) => {
    try {
      const late = getClient().sdk;
      unwrap(
        await late.comments.deleteInboxComment({
          path: { commentId },
          body: { accountId },
        }),
      );

      return textResponse(
        [
          '🗑️  Comment Deleted',
          '═'.repeat(35),
          `Comment ID: ${commentId}`,
          `Account:    ${accountId}`,
        ].join('\n'),
      );
    } catch (err) {
      return errorResponse(`Failed to delete comment: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── hide_comment ────────────────────────────────────────────────────────────

server.tool(
  'hide_comment',
  'Hide a comment so it is no longer publicly visible',
  {
    commentId: z.string().describe('The comment ID to hide'),
    accountId: z.string().describe('The account ID'),
  },
  async ({ commentId, accountId }) => {
    try {
      const late = getClient().sdk;
      unwrap(
        await late.comments.hideInboxComment({
          path: { commentId },
          body: { accountId },
        }),
      );

      return textResponse(
        [
          '🙈 Comment Hidden',
          '═'.repeat(35),
          `Comment ID: ${commentId}`,
          `Account:    ${accountId}`,
        ].join('\n'),
      );
    } catch (err) {
      return errorResponse(`Failed to hide comment: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── like_comment ────────────────────────────────────────────────────────────

server.tool(
  'like_comment',
  'Like a comment on a post',
  {
    commentId: z.string().describe('The comment ID to like'),
    accountId: z.string().describe('The account ID to like from'),
  },
  async ({ commentId, accountId }) => {
    try {
      const late = getClient().sdk;
      unwrap(
        await late.comments.likeInboxComment({
          path: { commentId },
          body: { accountId },
        }),
      );

      return textResponse(
        [
          '❤️  Comment Liked',
          '═'.repeat(35),
          `Comment ID: ${commentId}`,
          `Account:    ${accountId}`,
        ].join('\n'),
      );
    } catch (err) {
      return errorResponse(`Failed to like comment: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── send_private_reply ──────────────────────────────────────────────────────

server.tool(
  'send_private_reply',
  'Send a private/direct reply to a comment author',
  {
    commentId: z.string().describe('The comment ID to privately reply to'),
    accountId: z.string().describe('The account ID to send from'),
    message: z.string().describe('The private message text'),
  },
  async ({ commentId, accountId, message }) => {
    try {
      const late = getClient().sdk;
      const data = unwrap(
        await late.comments.sendPrivateReplyToComment({
          path: { commentId },
          body: { accountId, message },
        }),
      );

      const result = data as Record<string, unknown> | undefined;
      const lines: string[] = [
        '🔒 Private Reply Sent',
        '═'.repeat(45),
        `Comment ID: ${commentId}`,
        `Account:    ${accountId}`,
        `Message:    ${truncate(message, 100)}`,
      ];

      if (result?.id) lines.push(`Reply ID:   ${result.id}`);

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to send private reply: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}
