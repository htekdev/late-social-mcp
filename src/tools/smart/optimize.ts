import { z } from 'zod';
import { server } from '../../mcpServer.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { getBestTimesToPost, getPostingFrequency, getContentDecay } from '../../smart/optimizer.js';
import { loadScheduleConfig } from '../../config/scheduleConfig.js';

export function registerOptimizeTools(): void {
  server.tool(
    'get_best_times',
    'Get the best times to post based on engagement analytics. Compares against your current schedule config if available.',
    {
      platform: z.string().optional().describe('Filter to a specific platform'),
    },
    async ({ platform }) => {
      try {
        const results = await getBestTimesToPost(platform);

        if (results.length === 0) {
          return textResponse('No best-time data available. This requires published posts with engagement data.');
        }

        const config = loadScheduleConfig();
        const lines: string[] = ['📊 Best Times to Post', ''];

        for (const r of results) {
          lines.push(`Platform: ${r.platform}`);
          if (r.bestTimes.length === 0) {
            lines.push('  No data available');
            continue;
          }

          const sorted = [...r.bestTimes].sort((a, b) => b.engagement - a.engagement);
          for (const t of sorted.slice(0, 10)) {
            lines.push(`  • ${t.day} ${String(t.hour).padStart(2, '0')}:00 — engagement score: ${t.engagement}`);
          }

          if (config) {
            lines.push('', '  📋 Current schedule config comparison:');
            const platformConfig = config.platforms[r.platform];
            if (platformConfig) {
              for (const slot of platformConfig.slots) {
                lines.push(`    • ${slot.days.join(', ')} @ ${slot.time} — "${slot.label}"`);
              }
            } else {
              lines.push('    No schedule configured for this platform');
            }
          }
          lines.push('');
        }

        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Failed to get best times: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_posting_frequency',
    'Analyze optimal posting frequency per platform. Shows current vs recommended posts per week with engagement correlation.',
    {
      platform: z.string().optional().describe('Filter to a specific platform'),
    },
    async ({ platform }) => {
      try {
        const results = await getPostingFrequency(platform);

        if (results.length === 0) {
          return textResponse('No posting frequency data available. This requires publishing history.');
        }

        const lines: string[] = ['📈 Posting Frequency Analysis', ''];

        for (const r of results) {
          lines.push(`Platform: ${r.platform}`);
          lines.push(`  Current: ${r.currentFrequency} posts/week`);
          lines.push(`  Optimal: ${r.optimalFrequency} posts/week`);
          lines.push(`  Engagement correlation: ${(r.engagementCorrelation * 100).toFixed(1)}%`);
          lines.push(`  💡 ${r.recommendation}`);
          lines.push('');
        }

        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Failed to get posting frequency: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_content_decay',
    'Analyze how engagement accumulates over time for posts. Shows content lifespan and half-life (when 50% of engagement is reached).',
    {
      postId: z.string().optional().describe('Specific post ID to analyze. If omitted, analyzes top 5 recent posts.'),
      platform: z.string().optional().describe('Filter to a specific platform'),
    },
    async ({ postId, platform }) => {
      try {
        const results = await getContentDecay(postId, platform);

        if (results.length === 0) {
          return textResponse('No content decay data available. This requires published posts with engagement history.');
        }

        const lines: string[] = ['⏱️ Content Decay Analysis', ''];

        for (const r of results) {
          lines.push(`Post: ${r.postId} (${r.platform})`);
          lines.push(`  Published: ${r.publishedAt || 'unknown'}`);
          lines.push(`  Total engagement: ${r.totalEngagement}`);
          lines.push(`  Half-life: ${r.halfLifeHours !== null ? `${r.halfLifeHours} hours` : 'N/A'}`);

          if (r.decayPoints.length > 0) {
            lines.push('  Timeline:');
            for (const dp of r.decayPoints.slice(0, 8)) {
              const bar = '█'.repeat(Math.ceil(dp.percentOfTotal / 5));
              lines.push(`    ${String(dp.hoursAfterPublish).padStart(4)}h: ${bar} ${dp.percentOfTotal}% (${dp.cumulativeEngagement})`);
            }
          }
          lines.push('');
        }

        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Failed to get content decay: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
