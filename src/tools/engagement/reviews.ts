import { server } from '../../mcpServer.js';
import { getClient, toApiPlatform } from '../../client/lateClient.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { z } from 'zod';

// ── list_reviews ────────────────────────────────────────────────────────────

server.tool(
  'list_reviews',
  'List reviews from the inbox — Google Business, Facebook, etc.',
  {
    accountId: z.string().optional().describe('Filter by account ID'),
    platform: z.string().optional().describe('Filter by platform (e.g. google-business, facebook)'),
    limit: z.number().optional().describe('Max results to return'),
  },
  async ({ accountId, platform, limit }) => {
    try {
      const client = getClient();
      const items = await client.listReviews({
        accountId,
        platform: platform ? toApiPlatform(platform) : undefined,
        limit,
      });

      if (!items || items.length === 0) {
        return textResponse('No reviews found.');
      }
      const lines: string[] = ['⭐ Reviews', '═'.repeat(60)];

      for (const item of items) {
        const r = item as Record<string, unknown>;
        lines.push('');
        if (r.id ?? r.reviewId) lines.push(`Review ID:   ${r.id ?? r.reviewId}`);
        if (r.platform) lines.push(`Platform:    ${r.platform}`);
        if (r.authorName ?? r.author) lines.push(`Author:      ${r.authorName ?? r.author}`);
        if (r.rating !== undefined) lines.push(`Rating:      ${'★'.repeat(Number(r.rating))}${'☆'.repeat(5 - Number(r.rating))} (${r.rating}/5)`);
        if (r.message ?? r.text ?? r.comment) {
          lines.push(`Review:      ${truncate(String(r.message ?? r.text ?? r.comment), 100)}`);
        }
        if (r.reply) lines.push(`Your Reply:  ${truncate(String(r.reply), 80)}`);
        if (r.createdAt ?? r.date) lines.push(`Date:        ${r.createdAt ?? r.date}`);
        lines.push('─'.repeat(60));
      }

      lines.push(`\nTotal reviews: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to list reviews: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── reply_to_review ─────────────────────────────────────────────────────────

server.tool(
  'reply_to_review',
  'Reply to a review publicly',
  {
    reviewId: z.string().describe('The review ID to reply to'),
    accountId: z.string().describe('The account ID to reply from'),
    message: z.string().describe('The reply message text'),
  },
  async ({ reviewId, accountId, message }) => {
    try {
      const client = getClient();
      const result = await client.replyToReview(reviewId, accountId, message) as Record<string, unknown> | undefined;
      const lines: string[] = [
        '✅ Review Reply Sent',
        '═'.repeat(45),
        `Review ID:  ${reviewId}`,
        `Account:    ${accountId}`,
        `Reply:      ${truncate(message, 100)}`,
      ];

      if (result?.id) lines.push(`Reply ID:   ${result.id}`);

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to reply to review: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── delete_review_reply ─────────────────────────────────────────────────────

server.tool(
  'delete_review_reply',
  'Delete a reply to a review',
  {
    reviewReplyId: z.string().describe('The review reply ID to delete'),
    accountId: z.string().describe('The account ID that owns the reply'),
  },
  async ({ reviewReplyId, accountId }) => {
    try {
      const client = getClient();
      await client.deleteReviewReply(reviewReplyId, accountId);

      return textResponse(
        [
          '🗑️  Review Reply Deleted',
          '═'.repeat(40),
          `Reply ID: ${reviewReplyId}`,
          `Account:  ${accountId}`,
        ].join('\n'),
      );
    } catch (err) {
      return errorResponse(`Failed to delete review reply: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}
