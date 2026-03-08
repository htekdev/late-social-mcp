import { server } from '../mcpServer.js';
import { getClient, toDisplayPlatform } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

server.tool(
  'get_post_logs',
  'Show the publishing log history for a specific post',
  { postId: z.string() },
  async ({ postId }) => {
    try {
      const client = getClient();
      const logs = await client.getPostLogs(postId);

      if (logs.length === 0) {
        return textResponse(`No logs found for post ${postId}.`);
      }

      const lines = [`Post Logs: ${postId} (${logs.length} entries)`, ''];

      for (const [i, log] of logs.entries()) {
        const entry = log as Record<string, unknown>;
        const plat = entry.platform ? toDisplayPlatform(String(entry.platform)) : '';
        const timestamp = entry.timestamp ?? entry.createdAt ?? 'N/A';
        const status = entry.status ?? entry.action ?? 'N/A';
        const message = entry.message ?? entry.details ?? '';

        const header = plat ? `${i + 1}. [${plat}] ${status}` : `${i + 1}. ${status}`;
        lines.push(`${header} — ${timestamp}`);
        if (message) lines.push(`   ${message}`);
        if (entry.error) lines.push(`   Error: ${entry.error}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to get post logs: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'list_publishing_logs',
  'List publishing logs across posts — filter by status, platform, or action',
  {
    status: z.string().optional(),
    platform: z.string().optional(),
    action: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ status, platform, action, limit }) => {
    try {
      const client = getClient();
      const query: Record<string, unknown> = {};
      if (status) query.status = status;
      if (platform) query.platform = platform;
      if (action) query.action = action;
      if (limit) query.limit = limit;

      const logs = await client.listPublishingLogs(query);

      if (logs.length === 0) {
        return textResponse('No publishing logs found matching the filters.');
      }

      const filters = [status && `status=${status}`, platform && `platform=${platform}`, action && `action=${action}`]
        .filter(Boolean)
        .join(', ');

      const lines = [
        `Publishing Logs (${logs.length} entries)${filters ? ` — Filters: ${filters}` : ''}`,
        '',
      ];

      for (const [i, log] of logs.entries()) {
        const entry = log as Record<string, unknown>;
        const plat = entry.platform ? toDisplayPlatform(String(entry.platform)) : '';
        const timestamp = entry.timestamp ?? entry.createdAt ?? 'N/A';
        const logStatus = entry.status ?? 'N/A';
        const logAction = entry.action ?? '';
        const postId = entry.postId ?? '';

        const parts = [`${i + 1}.`];
        if (plat) parts.push(`[${plat}]`);
        parts.push(String(logStatus));
        if (logAction) parts.push(`(${logAction})`);
        parts.push(`— ${timestamp}`);
        if (postId) parts.push(`| Post: ${postId}`);

        lines.push(parts.join(' '));
        if (entry.message) lines.push(`   ${entry.message}`);
        if (entry.error) lines.push(`   Error: ${entry.error}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to list publishing logs: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'list_connection_logs',
  'List account connection logs — filter by platform or status',
  {
    platform: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ platform, status, limit }) => {
    try {
      const client = getClient();
      const query: Record<string, unknown> = {};
      if (platform) query.platform = platform;
      if (status) query.status = status;
      if (limit) query.limit = limit;

      const logs = await client.listConnectionLogs(query);

      if (logs.length === 0) {
        return textResponse('No connection logs found matching the filters.');
      }

      const filters = [platform && `platform=${platform}`, status && `status=${status}`]
        .filter(Boolean)
        .join(', ');

      const lines = [
        `Connection Logs (${logs.length} entries)${filters ? ` — Filters: ${filters}` : ''}`,
        '',
      ];

      for (const [i, log] of logs.entries()) {
        const entry = log as Record<string, unknown>;
        const plat = entry.platform ? toDisplayPlatform(String(entry.platform)) : '';
        const timestamp = entry.timestamp ?? entry.createdAt ?? 'N/A';
        const logStatus = entry.status ?? 'N/A';

        const parts = [`${i + 1}.`];
        if (plat) parts.push(`[${plat}]`);
        parts.push(String(logStatus));
        parts.push(`— ${timestamp}`);

        lines.push(parts.join(' '));
        if (entry.message) lines.push(`   ${entry.message}`);
        if (entry.error) lines.push(`   Error: ${entry.error}`);
        if (entry.accountId) lines.push(`   Account: ${entry.accountId}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to list connection logs: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);
