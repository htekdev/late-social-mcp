import { z } from 'zod';
import { server } from '../../mcpServer.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { detectConflicts, autoResolveConflicts } from '../../smart/scheduler.js';

export function registerRescheduleTools(): void {
  server.tool(
    'smart_reschedule',
    'Detect scheduling conflicts (duplicate times, posts outside configured windows) and auto-resolve by moving them to the next available configured slots.',
    {
      platform: z.string().optional().describe('Filter to a specific platform'),
      execute: z.boolean().optional().default(false).describe('If true, execute the moves immediately. Default is preview mode.'),
    },
    async ({ platform, execute }) => {
      try {
        const report = await detectConflicts(platform);

        if (report.conflicts.length === 0 && report.outOfWindow.length === 0) {
          return textResponse('✅ No scheduling conflicts detected. All posts are in valid schedule windows.');
        }

        if (!execute) {
          const lines: string[] = ['📋 Scheduling Conflict Report', ''];

          if (report.conflicts.length > 0) {
            lines.push(`⚠️ Time conflicts (${report.conflicts.length} posts):`);
            for (const c of report.conflicts.slice(0, 10)) {
              lines.push(`  • [${c.platform}] "${c.content}" at ${c.scheduledFor} — ${c.issue}`);
            }
            if (report.conflicts.length > 10) lines.push(`  ... and ${report.conflicts.length - 10} more`);
            lines.push('');
          }

          if (report.outOfWindow.length > 0) {
            lines.push(`📍 Out-of-window posts (${report.outOfWindow.length}):`);
            for (const o of report.outOfWindow.slice(0, 10)) {
              lines.push(`  • [${o.platform}] "${o.content}" at ${o.scheduledFor} — ${o.issue}`);
            }
            if (report.outOfWindow.length > 10) lines.push(`  ... and ${report.outOfWindow.length - 10} more`);
            lines.push('');
          }

          lines.push('Call smart_reschedule with execute=true to auto-resolve these conflicts.');
          return textResponse(lines.join('\n'));
        }

        const result = await autoResolveConflicts(platform, true);

        if (result.plan.length === 0) {
          return textResponse('No conflicts could be auto-resolved (no available slots found).');
        }

        const lines = [
          `✅ Auto-resolved ${result.plan.length} conflicts:`,
          '',
        ];
        for (const move of result.plan.slice(0, 15)) {
          lines.push(`  • ${move.postId}: ${move.from} → ${move.to} (${move.reason})`);
        }
        if (result.plan.length > 15) lines.push(`  ... and ${result.plan.length - 15} more`);

        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Smart reschedule failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
