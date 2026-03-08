import { z } from 'zod';
import { server } from '../../server.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { buildRealignPlan, executeRealignPlan, type RealignPlan } from '../../smart/realignment.js';
import { buildPrioritizedRealignPlan, type PriorityRule } from '../../smart/prioritizedRealignment.js';

const activePlans = new Map<string, RealignPlan>();
let planCounter = 0;

export function registerRealignTools(): void {
  server.tool(
    'realign_schedule',
    'Compact the schedule by filling gaps. Preview mode by default — shows what would change without executing. Pass execute=true to apply changes.',
    {
      platform: z.string().optional().describe('Filter to a specific platform (e.g., "x", "instagram", "youtube")'),
      clipType: z.string().optional().describe('Filter to a specific clip type (e.g., "short", "medium-clip", "video")'),
      execute: z.boolean().optional().default(false).describe('If true, execute the realignment plan immediately. Default is preview/dry-run mode.'),
    },
    async ({ platform, clipType, execute }) => {
      try {
        const plan = await buildRealignPlan({ platform, clipType });

        if (plan.posts.length === 0 && plan.toCancel.length === 0) {
          return textResponse('No posts need realignment. Schedule is already compact.');
        }

        if (!execute) {
          const planId = `realign-${++planCounter}`;
          activePlans.set(planId, plan);

          const lines: string[] = [
            `📋 Realignment Plan (ID: ${planId})`,
            `Total fetched: ${plan.totalFetched} | To move: ${plan.posts.length} | To cancel: ${plan.toCancel.length} | Already correct: ${plan.skipped}`,
            '',
          ];

          if (plan.toCancel.length > 0) {
            lines.push('🚫 Posts to cancel:');
            for (const c of plan.toCancel.slice(0, 10)) {
              lines.push(`  • [${c.platform}/${c.clipType}] "${c.content}" — ${c.reason}`);
            }
            if (plan.toCancel.length > 10) lines.push(`  ... and ${plan.toCancel.length - 10} more`);
            lines.push('');
          }

          lines.push('📅 Posts to reschedule:');
          for (const p of plan.posts.slice(0, 15)) {
            const from = p.oldScheduledFor ?? 'unscheduled';
            lines.push(`  • [${p.platform}/${p.clipType}] "${p.content}" — ${from} → ${p.newScheduledFor}`);
          }
          if (plan.posts.length > 15) lines.push(`  ... and ${plan.posts.length - 15} more`);

          lines.push('', `To execute this plan, call realign_schedule with execute=true or use check_realign_status with planId="${planId}".`);
          return textResponse(lines.join('\n'));
        }

        const result = await executeRealignPlan(plan);
        const lines = [
          '✅ Realignment complete!',
          `Updated: ${result.updated} | Cancelled: ${result.cancelled} | Failed: ${result.failed}`,
        ];
        if (result.errors.length > 0) {
          lines.push('', 'Errors:');
          for (const e of result.errors) {
            lines.push(`  • ${e.postId}: ${e.error}`);
          }
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Realignment failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'prioritized_realign',
    'Realign schedule with priority rules. Rules specify keywords to match in post content, saturation probability (0-1), and optional date ranges.',
    {
      platform: z.string().optional().describe('Filter to a specific platform'),
      clipType: z.string().optional().describe('Filter to a specific clip type'),
      priorities: z.array(z.object({
        keywords: z.array(z.string()).describe('Keywords to match in post content (case-insensitive)'),
        saturation: z.number().min(0).max(1).describe('Probability (0-1) that a matching post fills the slot. E.g., 0.7 = 70% of slots get priority content'),
        from: z.string().optional().describe('Start date for this rule (YYYY-MM-DD). Rule only applies to slots on/after this date'),
        to: z.string().optional().describe('End date for this rule (YYYY-MM-DD). Rule only applies to slots on/before this date'),
      })).describe('Priority rules evaluated in order. Each rule pulls matching posts into slots within the date range at the given saturation rate.'),
      execute: z.boolean().optional().default(false).describe('If true, execute immediately. Default is preview mode.'),
    },
    async ({ platform, clipType, priorities, execute }) => {
      try {
        const plan = await buildPrioritizedRealignPlan({
          priorities: priorities as PriorityRule[],
          platform,
          clipType,
        });

        if (plan.posts.length === 0 && plan.toCancel.length === 0) {
          return textResponse('No posts need realignment with these priority rules.');
        }

        if (!execute) {
          const planId = `prealign-${++planCounter}`;
          activePlans.set(planId, plan);

          const lines: string[] = [
            `📋 Prioritized Realignment Plan (ID: ${planId})`,
            `Total fetched: ${plan.totalFetched} | To move: ${plan.posts.length} | To cancel: ${plan.toCancel.length} | Skipped: ${plan.skipped}`,
            '',
            'Priority rules applied:',
          ];

          for (const rule of priorities) {
            lines.push(`  • Keywords: [${rule.keywords.join(', ')}] @ ${Math.round(rule.saturation * 100)}% saturation${rule.from ? ` from ${rule.from}` : ''}${rule.to ? ` to ${rule.to}` : ''}`);
          }

          lines.push('', '📅 Posts to reschedule:');
          for (const p of plan.posts.slice(0, 15)) {
            const from = p.oldScheduledFor ?? 'unscheduled';
            lines.push(`  • [${p.platform}/${p.clipType}] "${p.content}" — ${from} → ${p.newScheduledFor}`);
          }
          if (plan.posts.length > 15) lines.push(`  ... and ${plan.posts.length - 15} more`);

          lines.push('', `To execute, call prioritized_realign with execute=true or the same priorities.`);
          return textResponse(lines.join('\n'));
        }

        const result = await executeRealignPlan(plan);
        return textResponse([
          '✅ Prioritized realignment complete!',
          `Updated: ${result.updated} | Cancelled: ${result.cancelled} | Failed: ${result.failed}`,
        ].join('\n'));
      } catch (err) {
        return errorResponse(`Prioritized realignment failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'check_realign_status',
    'Check the status of a previously generated realignment plan or execute it.',
    {
      planId: z.string().describe('The plan ID returned from realign_schedule or prioritized_realign'),
      execute: z.boolean().optional().default(false).describe('If true, execute the stored plan'),
    },
    async ({ planId, execute }) => {
      const plan = activePlans.get(planId);
      if (!plan) {
        return errorResponse(`No plan found with ID "${planId}". Plans expire when the server restarts.`);
      }

      if (!execute) {
        return textResponse([
          `Plan "${planId}" is ready.`,
          `Posts to move: ${plan.posts.length} | To cancel: ${plan.toCancel.length}`,
          'Call check_realign_status with execute=true to apply this plan.',
        ].join('\n'));
      }

      try {
        const result = await executeRealignPlan(plan);
        activePlans.delete(planId);
        return textResponse([
          `✅ Plan "${planId}" executed!`,
          `Updated: ${result.updated} | Cancelled: ${result.cancelled} | Failed: ${result.failed}`,
        ].join('\n'));
      } catch (err) {
        return errorResponse(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
