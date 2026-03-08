import { loadScheduleConfig, normalizePlatform, getSlotsForPlatform } from '../config/scheduleConfig.js';
import { generateSlots, getDayOfWeekInTimezone } from './scheduler.js';
import { buildRealignPlan, type RealignPlan, type RealignPost, type CancelPost } from './realignment.js';

export interface PriorityRule {
  keywords: string[];
  saturation: number;
  from?: string;
  to?: string;
}

function isSlotInRange(slotIso: string, rule: PriorityRule, timezone: string): boolean {
  if (!rule.from && !rule.to) return true;
  const date = new Date(slotIso);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  const slotDate = `${year}-${month}-${day}`;
  if (rule.from && slotDate < rule.from) return false;
  if (rule.to && slotDate > rule.to) return false;
  return true;
}

function matchesKeywords(content: string, keywords: readonly string[]): boolean {
  const lower = content.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

export async function buildPrioritizedRealignPlan(options: {
  priorities: PriorityRule[];
  platform?: string;
  clipType?: string;
}): Promise<RealignPlan> {
  const config = loadScheduleConfig();
  if (!config) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 };
  }

  const basePlan = await buildRealignPlan({
    platform: options.platform,
    clipType: options.clipType,
  });

  if (basePlan.posts.length === 0) {
    return basePlan;
  }

  const { timezone } = config;

  const grouped = new Map<string, RealignPost[]>();
  for (const post of basePlan.posts) {
    const key = `${post.platform}::${post.clipType}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(post);
  }

  const result: RealignPost[] = [];
  const bookedMs = new Set<number>();

  for (const [key, posts] of grouped) {
    const [schedulePlatform, clipType] = key.split('::');

    const slots = generateSlots(schedulePlatform, clipType, posts.length * 2, bookedMs, timezone);
    if (slots.length === 0) continue;

    const usedPostIds = new Set<string>();

    const ruleQueues: RealignPost[][] = options.priorities.map(rule => {
      const matched = posts.filter(p =>
        p.content && matchesKeywords(p.content, rule.keywords),
      );
      matched.sort((a, b) => {
        const at = a.oldScheduledFor ? new Date(a.oldScheduledFor).getTime() : Infinity;
        const bt = b.oldScheduledFor ? new Date(b.oldScheduledFor).getTime() : Infinity;
        return at - bt;
      });
      return matched;
    });

    const priorityMatchedIds = new Set<string>();
    for (const queue of ruleQueues) {
      for (const p of queue) priorityMatchedIds.add(p.postId);
    }

    const remainingPool = posts
      .filter(p => !priorityMatchedIds.has(p.postId))
      .sort((a, b) => {
        const at = a.oldScheduledFor ? new Date(a.oldScheduledFor).getTime() : Infinity;
        const bt = b.oldScheduledFor ? new Date(b.oldScheduledFor).getTime() : Infinity;
        return at - bt;
      });
    let remainingIdx = 0;

    for (const slot of slots) {
      let assigned: RealignPost | undefined;

      for (let r = 0; r < options.priorities.length; r++) {
        const rule = options.priorities[r];
        const queue = ruleQueues[r];
        if (queue.length === 0) continue;
        if (!isSlotInRange(slot, rule, timezone)) continue;
        if (Math.random() >= rule.saturation) continue;

        while (queue.length > 0) {
          const candidate = queue.shift()!;
          if (!usedPostIds.has(candidate.postId)) {
            assigned = candidate;
            usedPostIds.add(candidate.postId);
            break;
          }
        }
        if (assigned) break;
      }

      if (!assigned) {
        while (remainingIdx < remainingPool.length) {
          const candidate = remainingPool[remainingIdx];
          remainingIdx++;
          if (!usedPostIds.has(candidate.postId)) {
            assigned = candidate;
            usedPostIds.add(candidate.postId);
            break;
          }
        }
      }

      if (!assigned) continue;

      result.push({
        ...assigned,
        newScheduledFor: slot,
      });
    }
  }

  result.sort((a, b) => new Date(a.newScheduledFor).getTime() - new Date(b.newScheduledFor).getTime());

  return {
    posts: result,
    toCancel: basePlan.toCancel,
    skipped: basePlan.skipped,
    unmatched: basePlan.unmatched,
    totalFetched: basePlan.totalFetched,
  };
}
