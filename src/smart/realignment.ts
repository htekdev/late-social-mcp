import { getClient, unwrap, toApiPlatform } from '../client/lateClient.js';
import { loadScheduleConfig, normalizePlatform } from '../config/scheduleConfig.js';
import { generateSlots, getDayOfWeekInTimezone, buildSlotDatetime } from './scheduler.js';

export interface RealignPost {
  postId: string;
  platform: string;
  clipType: string;
  content: string;
  oldScheduledFor: string | null;
  newScheduledFor: string;
}

export interface CancelPost {
  postId: string;
  platform: string;
  clipType: string;
  content: string;
  reason: string;
}

export interface RealignPlan {
  posts: RealignPost[];
  toCancel: CancelPost[];
  skipped: number;
  unmatched: number;
  totalFetched: number;
}

export interface RealignResult {
  updated: number;
  cancelled: number;
  failed: number;
  errors: Array<{ postId: string; error: string }>;
}

interface FetchedPost {
  id: string;
  content: string;
  scheduledFor: string | null;
  status: string;
  platforms: string[];
}

async function fetchAllPosts(
  statuses: readonly string[],
  platform?: string,
): Promise<FetchedPost[]> {
  const late = getClient().sdk;
  const allPosts: FetchedPost[] = [];
  const apiPlatform = platform ? toApiPlatform(platform) : undefined;

  for (const status of statuses) {
    const result = await late.posts.listPosts({
      query: { status, platform: apiPlatform, limit: 200 },
    });
    const data = unwrap(result);
    const posts = Array.isArray(data) ? data : (data as Record<string, unknown>).posts as unknown[] ?? [];

    for (const p of posts) {
      const post = p as Record<string, unknown>;
      const platformsRaw = post.platforms as unknown[];
      const platforms = platformsRaw?.map((pl: unknown) =>
        typeof pl === 'string' ? pl : (pl as Record<string, unknown>)?.platform as string ?? '',
      ) ?? [];

      allPosts.push({
        id: (post._id ?? post.id) as string,
        content: (post.content ?? '') as string,
        scheduledFor: (post.scheduledFor as string) ?? null,
        status: (post.status ?? '') as string,
        platforms,
      });
    }
  }

  return allPosts;
}

function inferClipType(content: string): string {
  const len = content.length;
  if (len < 280) return 'short';
  if (len < 1000) return 'medium-clip';
  return 'video';
}

export async function buildRealignPlan(options: {
  platform?: string;
  clipType?: string;
} = {}): Promise<RealignPlan> {
  const config = loadScheduleConfig();
  if (!config) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 };
  }

  const { timezone } = config;
  const statuses = ['scheduled', 'draft', 'cancelled', 'failed'] as const;
  const allPosts = await fetchAllPosts(statuses, options.platform);

  if (allPosts.length === 0) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 };
  }

  const grouped = new Map<string, Array<{ post: FetchedPost; platform: string; clipType: string }>>();
  let unmatched = 0;

  for (const post of allPosts) {
    const platform = post.platforms[0];
    if (!platform) continue;

    const clipType = options.clipType ?? inferClipType(post.content);
    const normalizedPlatform = normalizePlatform(platform, config);
    const key = `${normalizedPlatform}::${clipType}`;

    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ post, platform: normalizedPlatform, clipType });
  }

  const bookedMs = new Set<number>();
  const result: RealignPost[] = [];
  const toCancel: CancelPost[] = [];
  let skipped = 0;

  for (const [key, posts] of grouped) {
    const [schedulePlatform, clipType] = key.split('::');

    const slotsConfig = loadScheduleConfig();
    if (!slotsConfig) continue;

    const platformConfig = slotsConfig.platforms[schedulePlatform];
    const hasSlots = platformConfig && (
      (clipType && platformConfig.byClipType?.[clipType]?.slots.length) ||
      platformConfig.slots.length > 0
    );

    if (!hasSlots) {
      for (const { post, clipType: ct } of posts) {
        if (post.status === 'cancelled') continue;
        toCancel.push({
          postId: post.id,
          platform: schedulePlatform,
          clipType: ct,
          content: post.content.slice(0, 80),
          reason: `No schedule slots for ${schedulePlatform}/${clipType}`,
        });
      }
      continue;
    }

    posts.sort((a, b) => {
      const aTime = a.post.scheduledFor ? new Date(a.post.scheduledFor).getTime() : Infinity;
      const bTime = b.post.scheduledFor ? new Date(b.post.scheduledFor).getTime() : Infinity;
      return aTime - bTime;
    });

    const slots = generateSlots(schedulePlatform, clipType, posts.length, bookedMs, timezone);

    for (let i = 0; i < posts.length; i++) {
      const { post } = posts[i];
      const newSlot = slots[i];

      if (!newSlot) {
        if (post.status !== 'cancelled') {
          toCancel.push({
            postId: post.id,
            platform: schedulePlatform,
            clipType: posts[i].clipType,
            content: post.content.slice(0, 80),
            reason: `No more available slots for ${schedulePlatform}/${clipType}`,
          });
        }
        continue;
      }

      const currentMs = post.scheduledFor ? new Date(post.scheduledFor).getTime() : 0;
      const newMs = new Date(newSlot).getTime();
      if (currentMs === newMs && post.status === 'scheduled') {
        skipped++;
        continue;
      }

      result.push({
        postId: post.id,
        platform: schedulePlatform,
        clipType: posts[i].clipType,
        content: post.content.slice(0, 80),
        oldScheduledFor: post.scheduledFor,
        newScheduledFor: newSlot,
      });
    }
  }

  result.sort((a, b) => new Date(a.newScheduledFor).getTime() - new Date(b.newScheduledFor).getTime());

  return { posts: result, toCancel, skipped, unmatched, totalFetched: allPosts.length };
}

export async function executeRealignPlan(plan: RealignPlan): Promise<RealignResult> {
  const late = getClient().sdk;
  let updated = 0;
  let cancelled = 0;
  let failed = 0;
  const errors: Array<{ postId: string; error: string }> = [];

  for (const entry of plan.toCancel) {
    try {
      await late.posts.updatePost({
        path: { postId: entry.postId },
        body: { status: 'cancelled' } as Record<string, unknown>,
      });
      cancelled++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ postId: entry.postId, error: msg });
      failed++;
    }
  }

  for (const entry of plan.posts) {
    try {
      await late.posts.updatePost({
        path: { postId: entry.postId },
        body: { scheduledFor: entry.newScheduledFor, isDraft: false } as Record<string, unknown>,
      });
      updated++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ postId: entry.postId, error: msg });
      failed++;
    }
  }

  return { updated, cancelled, failed, errors };
}
