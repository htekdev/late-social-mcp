import { server } from '../mcpServer.js';
import { getClient } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

server.tool(
  'validate_post',
  'Dry-run validation of post content and media against platform rules — shows errors and warnings',
  {
    content: z.string(),
    platforms: z.string().describe('Comma-separated platform names'),
    mediaUrls: z.string().optional().describe('Comma-separated media URLs'),
  },
  async ({ content, platforms, mediaUrls }) => {
    try {
      const client = getClient();
      const platformList = platforms.split(',').map((p) => p.trim()).filter(Boolean);

      let mediaUrlList: string[] | undefined;
      if (mediaUrls) {
        mediaUrlList = mediaUrls.split(',').map((u) => u.trim()).filter(Boolean);
      }

      const result = await client.validatePost(content, platformList, mediaUrlList);

      const lines = [
        `Post Validation — ${platformList.join(', ')}`,
        `Content: "${content.length > 80 ? content.slice(0, 80) + '…' : content}"`,
      ];

      if (Array.isArray(result.errors) && result.errors.length > 0) {
        lines.push('', 'Errors:');
        for (const e of result.errors) {
          lines.push(`  ❌ [${e.platform ?? 'general'}] ${e.message ?? JSON.stringify(e)}`);
        }
      }

      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        lines.push('', 'Warnings:');
        for (const w of result.warnings) {
          lines.push(`  ⚠️ [${w.platform ?? 'general'}] ${w.message ?? JSON.stringify(w)}`);
        }
      }

      const hasErrors = Array.isArray(result.errors) && result.errors.length > 0;
      const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
      if (!hasErrors && !hasWarnings) {
        lines.push('', '✅ Post passed all validations.');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to validate post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'validate_post_length',
  'Check character count per platform and whether content is within limits',
  {
    content: z.string(),
    platforms: z.string().describe('Comma-separated platform names'),
  },
  async ({ content, platforms }) => {
    try {
      const client = getClient();
      const platformList = platforms.split(',').map((p) => p.trim()).filter(Boolean);

      const result = await client.validatePostLength(content, platformList);

      const lines = [
        `Post Length Check (${content.length} chars)`,
        `Content: "${content.length > 80 ? content.slice(0, 80) + '…' : content}"`,
        '',
      ];

      if (Array.isArray(result.platforms)) {
        for (const p of result.platforms) {
          const status = p.withinLimit ? '✅' : '❌';
          lines.push(`${status} ${p.platform}: ${p.length ?? content.length}/${p.maxLength ?? '?'} chars`);
        }
      } else if (typeof result === 'object') {
        for (const [key, val] of Object.entries(result)) {
          if (typeof val === 'object' && val !== null) {
            const plat = val as Record<string, unknown>;
            const status = plat.withinLimit ? '✅' : '❌';
            lines.push(`${status} ${key}: ${plat.length ?? content.length}/${plat.maxLength ?? '?'} chars`);
          }
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to validate post length: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'check_instagram_hashtags',
  'Check Instagram hashtags for banned, restricted, or safe status',
  { hashtags: z.string().describe('Comma-separated hashtags (with or without #)') },
  async ({ hashtags }) => {
    try {
      const client = getClient();
      const tagList = hashtags
        .split(',')
        .map((h) => h.trim().replace(/^#/, ''))
        .filter(Boolean);

      const result = await client.checkInstagramHashtags(tagList);

      const lines = [`Instagram Hashtag Check (${tagList.length} tags)`, ''];

      const statusIcon = (status: string): string => {
        if (status === 'banned') return '🚫';
        if (status === 'restricted') return '⚠️';
        return '✅';
      };

      if (Array.isArray(result.hashtags)) {
        for (const h of result.hashtags) {
          const status = String(h.status ?? 'unknown');
          lines.push(`${statusIcon(status)} #${h.hashtag ?? h.name ?? 'unknown'} — ${status}`);
        }
      } else if (Array.isArray(result.results)) {
        for (const h of result.results) {
          const status = String(h.status ?? 'unknown');
          lines.push(`${statusIcon(status)} #${h.hashtag ?? h.name ?? 'unknown'} — ${status}`);
        }
      } else {
        lines.push(JSON.stringify(result, null, 2));
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to check hashtags: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);
