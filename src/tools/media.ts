import { server } from '../mcpServer.js';
import { getClient } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

server.tool(
  'upload_media',
  'Get a presigned upload URL for a media file — returns the upload URL and public URL with instructions',
  { filename: z.string(), mimeType: z.string() },
  async ({ filename, mimeType }) => {
    try {
      const client = getClient();
      const result = await client.getPresignedUrl(filename, mimeType);

      const lines = [
        `Media Upload Ready: ${filename}`,
        `MIME Type: ${mimeType}`,
        '',
        `Upload URL (PUT): ${result.uploadUrl ?? 'N/A'}`,
        `Public URL: ${result.publicUrl ?? 'N/A'}`,
        '',
        'Instructions:',
        '1. Send a PUT request to the Upload URL with the file as the body.',
        `2. Set the Content-Type header to "${mimeType}".`,
        '3. Use the Public URL when creating posts with media.',
        '',
        'Example (curl):',
        `  curl -X PUT -H "Content-Type: ${mimeType}" --data-binary @${filename} "${result.uploadUrl ?? '<upload-url>'}"`,
      ];

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to get upload URL: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'validate_media',
  'Validate a media URL for accessibility and platform-specific size/format limits',
  { mediaUrl: z.string(), platforms: z.string().describe('Comma-separated platform names') },
  async ({ mediaUrl, platforms }) => {
    try {
      const client = getClient();
      const platformList = platforms.split(',').map((p) => p.trim()).filter(Boolean);

      const result = await client.validateMedia(mediaUrl, platformList);

      const lines = [`Media Validation: ${mediaUrl}`, `Platforms: ${platformList.join(', ')}`];

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
        lines.push('', '✅ Media passed all validations.');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to validate media: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);
