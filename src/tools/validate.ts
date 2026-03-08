import { server } from '../server.js';
import { getClient, unwrap } from '../client/lateClient.js';
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
      const late = getClient().sdk;
      const platformList = platforms.split(',').map((p) => p.trim()).filter(Boolean);
      const body: Record<string, unknown> = { content, platforms: platformList };

      if (mediaUrls) {
        const urls = mediaUrls.split(',').map((u) => u.trim()).filter(Boolean);
        body.mediaItems = urls.map((url) => ({ url }));
      }

      const data = unwrap(await late.validate.validatePost({ body }));
      const result = data as Record<string, unknown>;

      const lines = [
        `Post Validation — ${platformList.join(', ')}`,
        `Content: "${content.length > 80 ? content.slice(0, 80) + '…' : content}"`,
      ];

      if (Array.isArray(result.errors) && result.errors.length > 0) {
        lines.push('', 'Errors:');
        for (const e of result.errors) {
          const err = e as Record<string, unknown>;
          lines.push(`  ❌ [${err.platform ?? 'general'}] ${err.message ?? JSON.stringify(err)}`);
        }
      }

      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        lines.push('', 'Warnings:');
        for (const w of result.warnings) {
          const warn = w as Record<string, unknown>;
          lines.push(`  ⚠️ [${warn.platform ?? 'general'}] ${warn.message ?? JSON.stringify(warn)}`);
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
      const late = getClient().sdk;
      const platformList = platforms.split(',').map((p) => p.trim()).filter(Boolean);

      const data = unwrap(
        await late.validate.validatePostLength({ body: { content, platforms: platformList } }),
      );
      const result = data as Record<string, unknown>;

      const lines = [
        `Post Length Check (${content.length} chars)`,
        `Content: "${content.length > 80 ? content.slice(0, 80) + '…' : content}"`,
        '',
      ];

      if (Array.isArray(result.platforms)) {
        for (const p of result.platforms) {
          const plat = p as Record<string, unknown>;
          const status = plat.withinLimit ? '✅' : '❌';
          lines.push(`${status} ${plat.platform}: ${plat.length ?? content.length}/${plat.maxLength ?? '?'} chars`);
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
      const late = getClient().sdk;
      const tagList = hashtags
        .split(',')
        .map((h) => h.trim().replace(/^#/, ''))
        .filter(Boolean);

      const data = unwrap(
        await late.tools.checkInstagramHashtags({ body: { hashtags: tagList } }),
      );
      const result = data as Record<string, unknown>;

      const lines = [`Instagram Hashtag Check (${tagList.length} tags)`, ''];

      const statusIcon = (status: string): string => {
        if (status === 'banned') return '🚫';
        if (status === 'restricted') return '⚠️';
        return '✅';
      };

      if (Array.isArray(result.hashtags)) {
        for (const h of result.hashtags) {
          const tag = h as Record<string, unknown>;
          const status = String(tag.status ?? 'unknown');
          lines.push(`${statusIcon(status)} #${tag.hashtag ?? tag.name ?? 'unknown'} — ${status}`);
        }
      } else if (Array.isArray(result.results)) {
        for (const h of result.results) {
          const tag = h as Record<string, unknown>;
          const status = String(tag.status ?? 'unknown');
          lines.push(`${statusIcon(status)} #${tag.hashtag ?? tag.name ?? 'unknown'} — ${status}`);
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
