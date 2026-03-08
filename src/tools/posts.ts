import { z } from 'zod';
import { server } from '../mcpServer.js';
import { getClient, unwrap, toApiPlatform } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Not scheduled';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function formatPostSummary(post: Record<string, unknown>, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  const id = String(post.id ?? 'unknown');
  const status = String(post.status ?? 'unknown');
  const content = truncate(String(post.content ?? ''), 120);
  const platforms = Array.isArray(post.platforms) ? post.platforms.join(', ') : 'none';
  const scheduled = formatDate(post.scheduledFor as string | null);

  return [
    `${prefix}[${id}]`,
    `  Status: ${status}`,
    `  Platforms: ${platforms}`,
    `  Scheduled: ${scheduled}`,
    `  Content: ${content}`,
  ].join('\n');
}

function formatPostDetail(post: Record<string, unknown>): string {
  const lines: string[] = [
    `📝 Post Details`,
    `═══════════════`,
    '',
    `ID: ${post.id}`,
    `Status: ${post.status}`,
    `Platforms: ${Array.isArray(post.platforms) ? post.platforms.join(', ') : 'none'}`,
    `Scheduled: ${formatDate(post.scheduledFor as string | null)}`,
    `Created: ${formatDate(post.createdAt as string | null)}`,
    `Updated: ${formatDate(post.updatedAt as string | null)}`,
  ];

  if (post.platformPostUrl) {
    lines.push(`URL: ${post.platformPostUrl}`);
  }

  lines.push('', '--- Content ---', String(post.content ?? ''));

  const media = post.mediaItems;
  if (Array.isArray(media) && media.length > 0) {
    lines.push('', '--- Media ---');
    for (const item of media) {
      const m = item as Record<string, unknown>;
      lines.push(`  • [${m.type}] ${m.url}${m.altText ? ` (alt: ${m.altText})` : ''}`);
    }
  }

  return lines.join('\n');
}

server.tool(
  'list_posts',
  'List posts with optional filters for status, platform, search, limit, and page',
  {
    status: z.string().optional().describe('Filter by status: draft, scheduled, published, failed, cancelled'),
    platform: z.string().optional().describe('Filter by platform: twitter, instagram, linkedin, etc.'),
    search: z.string().optional().describe('Search posts by content'),
    limit: z.number().optional().describe('Max number of posts to return (default: 20)'),
    page: z.number().optional().describe('Page number for pagination'),
  },
  async ({ status, platform, search, limit, page }) => {
    try {
      const late = getClient().sdk;

      const query: Record<string, unknown> = {};
      if (status) query.status = status;
      if (platform) query.platform = toApiPlatform(platform);
      if (search) query.search = search;
      if (limit) query.limit = limit;
      if (page) query.page = page;

      const posts = unwrap(await late.posts.listPosts({ query }));

      const postList = Array.isArray(posts) ? posts : [];

      if (postList.length === 0) {
        const filters: string[] = [];
        if (status) filters.push(`status=${status}`);
        if (platform) filters.push(`platform=${platform}`);
        if (search) filters.push(`search="${search}"`);
        const filterDesc = filters.length > 0 ? ` matching ${filters.join(', ')}` : '';
        return textResponse(`No posts found${filterDesc}.`);
      }

      const lines: string[] = [
        `📋 Posts (${postList.length} results)`,
        '═══════════════════════════',
        '',
      ];

      for (let i = 0; i < postList.length; i++) {
        lines.push(formatPostSummary(postList[i] as Record<string, unknown>, i));
        if (i < postList.length - 1) lines.push('');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to list posts: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'get_post',
  'Get full details of a specific post by ID',
  {
    postId: z.string().describe('The ID of the post to retrieve'),
  },
  async ({ postId }) => {
    try {
      const late = getClient().sdk;
      const post = unwrap(await late.posts.getPost({ path: { postId } }));
      return textResponse(formatPostDetail(post as Record<string, unknown>));
    } catch (err: unknown) {
      return errorResponse(`Failed to get post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'create_post',
  'Create a new social media post. Provide comma-separated platform names and optional scheduling.',
  {
    content: z.string().describe('The post content/text'),
    platforms: z.string().describe('Comma-separated platform names: twitter, instagram, linkedin, etc.'),
    scheduledFor: z.string().optional().describe('ISO 8601 datetime for scheduling (e.g. 2025-01-15T10:00:00Z)'),
    publishNow: z.boolean().optional().describe('Publish immediately instead of scheduling'),
    isDraft: z.boolean().optional().describe('Save as draft without scheduling'),
    mediaUrls: z.string().optional().describe('Comma-separated media URLs to attach'),
  },
  async ({ content, platforms, scheduledFor, publishNow, isDraft, mediaUrls }) => {
    try {
      const late = getClient().sdk;

      const platformList = platforms
        .split(',')
        .map((p) => toApiPlatform(p.trim()))
        .filter((p) => p.length > 0);

      if (platformList.length === 0) {
        return errorResponse('At least one platform is required. Example: twitter, instagram');
      }

      const body: Record<string, unknown> = {
        content,
        platforms: platformList,
      };
      if (scheduledFor) body.scheduledFor = scheduledFor;
      if (publishNow !== undefined) body.publishNow = publishNow;
      if (isDraft !== undefined) body.isDraft = isDraft;
      if (mediaUrls) {
        body.mediaUrls = mediaUrls
          .split(',')
          .map((u) => u.trim())
          .filter((u) => u.length > 0);
      }

      const post = unwrap(await late.posts.createPost({ body }));
      const created = post as Record<string, unknown>;

      const action = publishNow ? 'published' : isDraft ? 'saved as draft' : 'scheduled';

      const lines: string[] = [
        `✅ Post ${action} successfully!`,
        '',
        `ID: ${created.id}`,
        `Status: ${created.status}`,
        `Platforms: ${platformList.join(', ')}`,
      ];

      if (scheduledFor) {
        lines.push(`Scheduled for: ${formatDate(scheduledFor)}`);
      }

      lines.push(`Content: ${truncate(content, 120)}`);

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to create post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'update_post',
  'Update an existing post content or schedule',
  {
    postId: z.string().describe('The ID of the post to update'),
    content: z.string().optional().describe('New post content'),
    scheduledFor: z.string().optional().describe('New scheduled time (ISO 8601)'),
  },
  async ({ postId, content, scheduledFor }) => {
    try {
      const late = getClient().sdk;

      const body: Record<string, unknown> = {};
      if (content !== undefined) body.content = content;
      if (scheduledFor !== undefined) body.scheduledFor = scheduledFor;

      if (Object.keys(body).length === 0) {
        return errorResponse('Nothing to update. Provide at least content or scheduledFor.');
      }

      const post = unwrap(await late.posts.updatePost({ path: { postId }, body }));
      const updated = post as Record<string, unknown>;

      const changes: string[] = [];
      if (content !== undefined) changes.push('content');
      if (scheduledFor !== undefined) changes.push('schedule');

      const lines: string[] = [
        `✅ Post updated successfully!`,
        '',
        `ID: ${updated.id}`,
        `Updated: ${changes.join(', ')}`,
        `Status: ${updated.status}`,
      ];

      if (scheduledFor) {
        lines.push(`New schedule: ${formatDate(scheduledFor)}`);
      }

      if (content) {
        lines.push(`Content: ${truncate(content, 120)}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to update post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'delete_post',
  'Delete a post by ID',
  {
    postId: z.string().describe('The ID of the post to delete'),
  },
  async ({ postId }) => {
    try {
      const late = getClient().sdk;
      unwrap(await late.posts.deletePost({ path: { postId } }));
      return textResponse(`✅ Post ${postId} deleted successfully.`);
    } catch (err: unknown) {
      return errorResponse(`Failed to delete post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'retry_post',
  'Retry a failed post by ID',
  {
    postId: z.string().describe('The ID of the failed post to retry'),
  },
  async ({ postId }) => {
    try {
      const late = getClient().sdk;
      const post = unwrap(await late.posts.retryPost({ path: { postId } }));
      const retried = post as Record<string, unknown>;

      return textResponse(
        [
          `🔄 Post retry initiated!`,
          '',
          `ID: ${retried.id}`,
          `Status: ${retried.status}`,
          `Platforms: ${Array.isArray(retried.platforms) ? retried.platforms.join(', ') : 'unknown'}`,
        ].join('\n'),
      );
    } catch (err: unknown) {
      return errorResponse(`Failed to retry post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'unpublish_post',
  'Unpublish a post from specified platforms',
  {
    postId: z.string().describe('The ID of the post to unpublish'),
    platforms: z.string().describe('Comma-separated platform names to unpublish from'),
  },
  async ({ postId, platforms }) => {
    try {
      const late = getClient().sdk;

      const platformList = platforms
        .split(',')
        .map((p) => toApiPlatform(p.trim()))
        .filter((p) => p.length > 0);

      if (platformList.length === 0) {
        return errorResponse('At least one platform is required.');
      }

      unwrap(
        await late.posts.unpublishPost({
          path: { postId },
          body: { platforms: platformList },
        }),
      );

      return textResponse(
        [
          `✅ Post ${postId} unpublished successfully!`,
          '',
          `Removed from: ${platformList.join(', ')}`,
        ].join('\n'),
      );
    } catch (err: unknown) {
      return errorResponse(`Failed to unpublish post: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'bulk_upload_posts',
  'Bulk upload posts via CSV content. Provide the CSV data as a string.',
  {
    csvContent: z.string().describe('CSV content with columns: content, platforms, scheduledFor (one post per row)'),
    dryRun: z.boolean().optional().describe('Preview the posts without creating them'),
  },
  async ({ csvContent, dryRun }) => {
    try {
      const lines = csvContent.split('\n').filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        return errorResponse('CSV content is empty.');
      }

      const headerLine = lines[0];
      const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

      const contentIdx = headers.indexOf('content');
      const platformsIdx = headers.indexOf('platforms');
      const scheduledIdx = headers.indexOf('scheduledfor');

      if (contentIdx === -1 || platformsIdx === -1) {
        return errorResponse(
          'CSV must have at least "content" and "platforms" columns.\n\n' +
            'Expected format:\n' +
            'content,platforms,scheduledFor\n' +
            '"Hello world!","twitter,instagram","2025-01-15T10:00:00Z"\n' +
            '"Another post","linkedin",""',
        );
      }

      const dataLines = lines.slice(1);
      if (dataLines.length === 0) {
        return errorResponse('CSV has headers but no data rows.');
      }

      const parsedRows: Array<{
        content: string;
        platforms: string[];
        scheduledFor?: string;
      }> = [];

      for (let i = 0; i < dataLines.length; i++) {
        const fields = parseCsvLine(dataLines[i]);
        const content = fields[contentIdx]?.trim() ?? '';
        const platformsRaw = fields[platformsIdx]?.trim() ?? '';
        const scheduledFor = scheduledIdx !== -1 ? fields[scheduledIdx]?.trim() : undefined;

        if (!content) {
          return errorResponse(`Row ${i + 2}: Content is empty.`);
        }
        if (!platformsRaw) {
          return errorResponse(`Row ${i + 2}: Platforms are empty.`);
        }

        const platformList = platformsRaw
          .split(/[;|]/)
          .map((p) => toApiPlatform(p.trim()))
          .filter((p) => p.length > 0);

        parsedRows.push({
          content,
          platforms: platformList,
          scheduledFor: scheduledFor && scheduledFor.length > 0 ? scheduledFor : undefined,
        });
      }

      if (dryRun) {
        const output: string[] = [
          `📋 Bulk Upload Preview (${parsedRows.length} posts)`,
          '═══════════════════════════════════════',
          '',
        ];

        for (let i = 0; i < parsedRows.length; i++) {
          const row = parsedRows[i];
          output.push(`${i + 1}. Platforms: ${row.platforms.join(', ')}`);
          output.push(`   Scheduled: ${row.scheduledFor ? formatDate(row.scheduledFor) : 'Not scheduled'}`);
          output.push(`   Content: ${truncate(row.content, 120)}`);
          if (i < parsedRows.length - 1) output.push('');
        }

        output.push('', '⚠️  This is a dry run. Set dryRun=false to create these posts.');
        return textResponse(output.join('\n'));
      }

      const late = getClient().sdk;
      const results: Array<{ index: number; id?: string; error?: string }> = [];

      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i];
        try {
          const body: Record<string, unknown> = {
            content: row.content,
            platforms: row.platforms,
          };
          if (row.scheduledFor) body.scheduledFor = row.scheduledFor;

          const post = unwrap(await late.posts.createPost({ body }));
          const created = post as Record<string, unknown>;
          results.push({ index: i, id: String(created.id) });
        } catch (err: unknown) {
          results.push({
            index: i,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const succeeded = results.filter((r) => r.id);
      const failed = results.filter((r) => r.error);

      const output: string[] = [
        `📦 Bulk Upload Complete`,
        '═══════════════════════',
        '',
        `✅ Created: ${succeeded.length}`,
        `❌ Failed: ${failed.length}`,
        `Total: ${parsedRows.length}`,
      ];

      if (succeeded.length > 0) {
        output.push('', 'Created posts:');
        for (const r of succeeded) {
          output.push(`  ${r.index + 1}. ID: ${r.id} — ${truncate(parsedRows[r.index].content, 80)}`);
        }
      }

      if (failed.length > 0) {
        output.push('', 'Failed posts:');
        for (const r of failed) {
          output.push(`  ${r.index + 1}. Error: ${r.error}`);
        }
      }

      return textResponse(output.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Bulk upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}
