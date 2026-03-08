import { server } from '../mcpServer.js';
import { getClient, toApiPlatform } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

// ── get_post_analytics ──────────────────────────────────────────────────────

server.tool(
  'get_post_analytics',
  'Get analytics for posts — impressions, reach, likes, comments, shares, and more',
  {
    postId: z.string().optional().describe('Filter by specific post ID'),
    platform: z.string().optional().describe('Filter by platform (e.g. instagram, twitter, tiktok)'),
    fromDate: z.string().optional().describe('Start date (ISO 8601, e.g. 2024-01-01)'),
    toDate: z.string().optional().describe('End date (ISO 8601, e.g. 2024-01-31)'),
    limit: z.number().optional().describe('Max results to return'),
  },
  async ({ postId, platform, fromDate, toDate, limit }) => {
    try {
      const client = getClient();
      const items = await client.getAnalytics({
        postId,
        fromDate,
        toDate,
        platform: platform ? toApiPlatform(platform) : undefined,
        limit,
      });

      if (items.length === 0) {
        return textResponse('No analytics data found for the given filters.');
      }
      const lines: string[] = ['📊 Post Analytics', '═'.repeat(50)];

      for (const item of items) {
        const entry = item as Record<string, unknown>;
        lines.push('');
        if (entry.postId) lines.push(`Post ID:      ${entry.postId}`);
        if (entry.platform) lines.push(`Platform:     ${entry.platform}`);
        if (entry.impressions !== undefined) lines.push(`Impressions:  ${entry.impressions}`);
        if (entry.reach !== undefined) lines.push(`Reach:        ${entry.reach}`);
        if (entry.likes !== undefined) lines.push(`Likes:        ${entry.likes}`);
        if (entry.comments !== undefined) lines.push(`Comments:     ${entry.comments}`);
        if (entry.shares !== undefined) lines.push(`Shares:       ${entry.shares}`);
        if (entry.saves !== undefined) lines.push(`Saves:        ${entry.saves}`);
        if (entry.clicks !== undefined) lines.push(`Clicks:       ${entry.clicks}`);
        if (entry.engagementRate !== undefined) lines.push(`Engagement:   ${entry.engagementRate}%`);
        if (entry.date) lines.push(`Date:         ${entry.date}`);
        lines.push('─'.repeat(50));
      }

      lines.push(`\nTotal results: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get post analytics: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_daily_metrics ───────────────────────────────────────────────────────

server.tool(
  'get_daily_metrics',
  'Get daily aggregated metrics across platforms — impressions, reach, engagement per day',
  {
    dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
    dateTo: z.string().optional().describe('End date (ISO 8601)'),
    platforms: z.string().optional().describe('Comma-separated list of platforms (e.g. instagram,twitter)'),
    limit: z.number().optional().describe('Max results to return'),
  },
  async ({ dateFrom, dateTo, platforms, limit }) => {
    try {
      const client = getClient();
      const platformsList = platforms
        ? platforms.split(',').map((p) => toApiPlatform(p.trim())).join(',')
        : undefined;

      const items = await client.getDailyMetrics({
        dateFrom,
        dateTo,
        platforms: platformsList,
        limit,
      });

      if (items.length === 0) {
        return textResponse('No daily metrics found for the given filters.');
      }
      const lines: string[] = ['📈 Daily Metrics', '═'.repeat(60)];
      lines.push(
        padRight('Date', 14) +
        padRight('Impressions', 14) +
        padRight('Reach', 10) +
        padRight('Likes', 8) +
        padRight('Comments', 10) +
        'Shares',
      );
      lines.push('─'.repeat(60));

      for (const item of items) {
        const m = item;
        lines.push(
          padRight(String(m.date ?? '—'), 14) +
          padRight(String(m.impressions ?? '—'), 14) +
          padRight(String(m.reach ?? '—'), 10) +
          padRight(String(m.likes ?? '—'), 8) +
          padRight(String(m.comments ?? '—'), 10) +
          String(m.shares ?? '—'),
        );
      }

      lines.push('─'.repeat(60));
      lines.push(`Total days: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get daily metrics: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_follower_stats ──────────────────────────────────────────────────────

server.tool(
  'get_follower_stats',
  'Get follower growth statistics for connected accounts',
  {
    accountId: z.string().optional().describe('Filter by specific account ID'),
    dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
    dateTo: z.string().optional().describe('End date (ISO 8601)'),
    limit: z.number().optional().describe('Max results to return'),
  },
  async ({ accountId, dateFrom, dateTo, limit }) => {
    try {
      const client = getClient();
      const items = await client.getFollowerStats({ dateFrom, dateTo, accountId, limit });

      if (items.length === 0) {
        return textResponse('No follower stats found for the given filters.');
      }
      const lines: string[] = ['👥 Follower Stats', '═'.repeat(55)];

      for (const item of items) {
        const s = item as Record<string, unknown>;
        lines.push('');
        if (s.accountId) lines.push(`Account ID:   ${s.accountId}`);
        if (s.platform) lines.push(`Platform:     ${s.platform}`);
        if (s.date) lines.push(`Date:         ${s.date}`);
        if (s.followers !== undefined) lines.push(`Followers:    ${s.followers}`);
        if (s.following !== undefined) lines.push(`Following:    ${s.following}`);
        if (s.gained !== undefined) lines.push(`Gained:       +${s.gained}`);
        if (s.lost !== undefined) lines.push(`Lost:         -${s.lost}`);
        if (s.netChange !== undefined) lines.push(`Net Change:   ${Number(s.netChange) >= 0 ? '+' : ''}${s.netChange}`);
        lines.push('─'.repeat(55));
      }

      lines.push(`\nTotal records: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get follower stats: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_post_timeline ───────────────────────────────────────────────────────

server.tool(
  'get_post_timeline',
  'Get the engagement timeline for a specific post over time',
  {
    postId: z.string().describe('The post ID to get timeline data for'),
    dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
    dateTo: z.string().optional().describe('End date (ISO 8601)'),
  },
  async ({ postId, dateFrom, dateTo }) => {
    try {
      const client = getClient();
      const items = await client.getPostTimeline(postId, { dateFrom, dateTo });

      if (items.length === 0) {
        return textResponse(`No timeline data found for post ${postId}.`);
      }
      const lines: string[] = [
        `📅 Post Timeline — ${postId}`,
        '═'.repeat(60),
        padRight('Date/Time', 22) +
        padRight('Impressions', 14) +
        padRight('Likes', 8) +
        padRight('Comments', 10) +
        'Shares',
        '─'.repeat(60),
      ];

      for (const item of items) {
        const t = item as Record<string, unknown>;
        lines.push(
          padRight(String(t.date ?? t.timestamp ?? '—'), 22) +
          padRight(String(t.impressions ?? '—'), 14) +
          padRight(String(t.likes ?? '—'), 8) +
          padRight(String(t.comments ?? '—'), 10) +
          String(t.shares ?? '—'),
        );
      }

      lines.push('─'.repeat(60));
      lines.push(`Total data points: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get post timeline: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_youtube_daily_views ─────────────────────────────────────────────────

server.tool(
  'get_youtube_daily_views',
  'Get daily view counts for a YouTube video over a date range',
  {
    videoId: z.string().describe('The YouTube video ID'),
    dateFrom: z.string().optional().describe('Start date (ISO 8601)'),
    dateTo: z.string().optional().describe('End date (ISO 8601)'),
  },
  async ({ videoId, dateFrom, dateTo }) => {
    try {
      const client = getClient();
      const items = await client.getYouTubeDailyViews(videoId, { dateFrom, dateTo });

      if (items.length === 0) {
        return textResponse(`No YouTube view data found for video ${videoId}.`);
      }
      const lines: string[] = [
        `▶️  YouTube Daily Views — ${videoId}`,
        '═'.repeat(40),
        padRight('Date', 16) + 'Views',
        '─'.repeat(40),
      ];

      let totalViews = 0;
      for (const item of items) {
        const v = item;
        const views = Number(v.views ?? v.count ?? 0);
        totalViews += views;
        lines.push(padRight(String(v.date ?? '—'), 16) + String(views));
      }

      lines.push('─'.repeat(40));
      lines.push(`Total views: ${totalViews}`);
      lines.push(`Days tracked: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get YouTube daily views: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── helpers ─────────────────────────────────────────────────────────────────

function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}
