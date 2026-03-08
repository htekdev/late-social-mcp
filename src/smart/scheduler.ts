import type { DayOfWeek } from '../types/schedule.js';
import { loadScheduleConfig, getSlotsForPlatform, normalizePlatform } from '../config/scheduleConfig.js';
import { getClient, toApiPlatform } from '../client/lateClient.js';

const CHUNK_DAYS = 14;
const MAX_LOOKAHEAD_DAYS = 730;

function getTimezoneOffset(timezone: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  const match = tzPart?.value?.match(/GMT([+-]\d{2}:\d{2})/);
  if (match) return match[1];
  if (tzPart?.value === 'GMT') return '+00:00';
  return '+00:00';
}

export function buildSlotDatetime(date: Date, time: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value ?? String(date.getFullYear());
  const month = (parts.find(p => p.type === 'month')?.value ?? String(date.getMonth() + 1)).padStart(2, '0');
  const day = (parts.find(p => p.type === 'day')?.value ?? String(date.getDate())).padStart(2, '0');
  const offset = getTimezoneOffset(timezone, date);
  return `${year}-${month}-${day}T${time}:00${offset}`;
}

export function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const short = formatter.format(date).toLowerCase().slice(0, 3);
  const map: Record<string, DayOfWeek> = {
    sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat',
  };
  return map[short] ?? 'mon';
}

function normalizeDateTime(isoString: string): number {
  return new Date(isoString).getTime();
}

interface ScheduledPost {
  id: string;
  scheduledFor: string;
  platform: string;
  content: string;
  status: string;
}

async function fetchScheduledPosts(platform?: string): Promise<ScheduledPost[]> {
  const client = getClient();
  const apiPlatform = platform ? toApiPlatform(platform) : undefined;
  const posts = await client.listPosts({ status: 'scheduled', platform: apiPlatform, limit: 200 });
  return posts.map((p: unknown) => {
    const post = p as Record<string, unknown>;
    const platforms = post.platforms as unknown[];
    const firstPlatform = platforms?.[0];
    const platformStr = typeof firstPlatform === 'string'
      ? firstPlatform
      : (firstPlatform as Record<string, unknown>)?.platform as string ?? '';
    return {
      id: (post._id ?? post.id) as string,
      scheduledFor: post.scheduledFor as string,
      platform: platformStr,
      content: (post.content ?? '') as string,
      status: (post.status ?? 'scheduled') as string,
    };
  });
}

export function generateSlots(
  platform: string,
  clipType: string | undefined,
  count: number,
  bookedMs: Set<number>,
  timezone: string,
): string[] {
  const config = loadScheduleConfig();
  if (!config) return [];

  const normalizedPlatform = normalizePlatform(platform, config);
  const slots = getSlotsForPlatform(config, normalizedPlatform, clipType);
  if (slots.length === 0) return [];

  const platformConfig = config.platforms[normalizedPlatform];
  const avoidDays = (clipType && platformConfig?.byClipType?.[clipType]?.avoidDays)
    ?? platformConfig?.avoidDays ?? [];

  const available: string[] = [];
  const now = new Date();
  const nowMs = now.getTime();

  for (let dayOffset = 0; dayOffset < 730 && available.length < count; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);

    const dayOfWeek = getDayOfWeekInTimezone(day, timezone);
    if (avoidDays.includes(dayOfWeek)) continue;

    for (const slot of slots) {
      if (available.length >= count) break;
      if (!slot.days.includes(dayOfWeek)) continue;

      const iso = buildSlotDatetime(day, slot.time, timezone);
      const ms = new Date(iso).getTime();
      if (ms <= nowMs) continue;
      if (!bookedMs.has(ms)) {
        available.push(iso);
        bookedMs.add(ms);
      }
    }
  }

  return available;
}

export async function findNextAvailableSlot(
  platform: string,
  clipType?: string,
): Promise<{ slot: string; label: string } | null> {
  const config = loadScheduleConfig();
  if (!config) return null;

  const normalizedPlatform = normalizePlatform(platform, config);
  const slots = getSlotsForPlatform(config, normalizedPlatform, clipType);
  if (slots.length === 0) return null;

  const { timezone } = config;
  const platformConfig = config.platforms[normalizedPlatform];
  const avoidDays = (clipType && platformConfig?.byClipType?.[clipType]?.avoidDays)
    ?? platformConfig?.avoidDays ?? [];

  const scheduledPosts = await fetchScheduledPosts(platform);
  const bookedMs = new Set(scheduledPosts.map(p => normalizeDateTime(p.scheduledFor)));

  const now = new Date();
  const nowMs = now.getTime();
  let startOffset = 0;

  while (startOffset <= MAX_LOOKAHEAD_DAYS) {
    const endOffset = Math.min(startOffset + CHUNK_DAYS - 1, MAX_LOOKAHEAD_DAYS);

    for (let dayOffset = startOffset; dayOffset <= endOffset; dayOffset++) {
      const candidateDate = new Date(now);
      candidateDate.setDate(candidateDate.getDate() + dayOffset);

      const dayOfWeek = getDayOfWeekInTimezone(candidateDate, timezone);
      if (avoidDays.includes(dayOfWeek)) continue;

      for (const slot of slots) {
        if (!slot.days.includes(dayOfWeek)) continue;
        const iso = buildSlotDatetime(candidateDate, slot.time, timezone);
        const ms = new Date(iso).getTime();
        if (ms <= nowMs) continue;
        if (!bookedMs.has(ms)) {
          return { slot: iso, label: slot.label };
        }
      }
    }

    startOffset = endOffset + 1;
  }

  return null;
}

export interface ConflictReport {
  conflicts: Array<{
    postId: string;
    scheduledFor: string;
    platform: string;
    content: string;
    issue: string;
  }>;
  outOfWindow: Array<{
    postId: string;
    scheduledFor: string;
    platform: string;
    content: string;
    issue: string;
  }>;
}

export async function detectConflicts(platform?: string): Promise<ConflictReport> {
  const config = loadScheduleConfig();
  const scheduledPosts = await fetchScheduledPosts(platform);

  const conflicts: ConflictReport['conflicts'] = [];
  const outOfWindow: ConflictReport['outOfWindow'] = [];

  const timeSlotMap = new Map<string, ScheduledPost[]>();
  for (const post of scheduledPosts) {
    const key = `${post.platform}::${post.scheduledFor}`;
    if (!timeSlotMap.has(key)) timeSlotMap.set(key, []);
    timeSlotMap.get(key)!.push(post);
  }

  for (const [, posts] of timeSlotMap) {
    if (posts.length > 1) {
      for (const post of posts) {
        conflicts.push({
          postId: post.id,
          scheduledFor: post.scheduledFor,
          platform: post.platform,
          content: post.content.slice(0, 80),
          issue: `${posts.length} posts scheduled at the same time on ${post.platform}`,
        });
      }
    }
  }

  if (config) {
    const { timezone } = config;
    for (const post of scheduledPosts) {
      const normalizedPlatform = normalizePlatform(post.platform, config);
      const platformSchedule = config.platforms[normalizedPlatform];
      if (!platformSchedule) continue;

      const date = new Date(post.scheduledFor);
      const dayOfWeek = getDayOfWeekInTimezone(date, timezone);

      if (platformSchedule.avoidDays.includes(dayOfWeek)) {
        outOfWindow.push({
          postId: post.id,
          scheduledFor: post.scheduledFor,
          platform: post.platform,
          content: post.content.slice(0, 80),
          issue: `Scheduled on avoided day: ${dayOfWeek}`,
        });
        continue;
      }

      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const timeParts = timeFormatter.formatToParts(date);
      const hour = timeParts.find(p => p.type === 'hour')?.value ?? '00';
      const minute = timeParts.find(p => p.type === 'minute')?.value ?? '00';
      const timeKey = `${hour}:${minute}`;

      const allSlots = [
        ...platformSchedule.slots,
        ...Object.values(platformSchedule.byClipType ?? {}).flatMap(ct => ct.slots),
      ];
      const matchesSlot = allSlots.some(slot =>
        slot.time === timeKey && slot.days.includes(dayOfWeek),
      );

      if (!matchesSlot) {
        outOfWindow.push({
          postId: post.id,
          scheduledFor: post.scheduledFor,
          platform: post.platform,
          content: post.content.slice(0, 80),
          issue: `Time ${timeKey} on ${dayOfWeek} doesn't match any configured slot`,
        });
      }
    }
  }

  return { conflicts, outOfWindow };
}

export async function autoResolveConflicts(
  platform?: string,
  execute = false,
): Promise<{
  plan: Array<{ postId: string; from: string; to: string; reason: string }>;
  executed: boolean;
}> {
  const config = loadScheduleConfig();
  if (!config) {
    return { plan: [], executed: false };
  }

  const report = await detectConflicts(platform);
  const allIssues = [...report.conflicts, ...report.outOfWindow];
  if (allIssues.length === 0) {
    return { plan: [], executed: false };
  }

  const seenPostIds = new Set<string>();
  const uniqueIssues = allIssues.filter(issue => {
    if (seenPostIds.has(issue.postId)) return false;
    seenPostIds.add(issue.postId);
    return true;
  });

  uniqueIssues.sort((a, b) =>
    new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
  );

  const scheduledPosts = await fetchScheduledPosts(platform);
  const bookedMs = new Set(scheduledPosts.map(p => normalizeDateTime(p.scheduledFor)));

  const plan: Array<{ postId: string; from: string; to: string; reason: string }> = [];
  const { timezone } = config;

  for (const issue of uniqueIssues) {
    const normalizedPlatform = normalizePlatform(issue.platform, config);
    const slots = getSlotsForPlatform(config, normalizedPlatform);
    if (slots.length === 0) continue;

    const platformConfig = config.platforms[normalizedPlatform];
    const avoidDays = platformConfig?.avoidDays ?? [];

    const now = new Date();
    const nowMs = now.getTime();
    let found = false;

    for (let dayOffset = 0; dayOffset < 60 && !found; dayOffset++) {
      const candidateDate = new Date(now);
      candidateDate.setDate(candidateDate.getDate() + dayOffset);
      const dayOfWeek = getDayOfWeekInTimezone(candidateDate, timezone);
      if (avoidDays.includes(dayOfWeek)) continue;

      for (const slot of slots) {
        if (!slot.days.includes(dayOfWeek)) continue;
        const iso = buildSlotDatetime(candidateDate, slot.time, timezone);
        const ms = new Date(iso).getTime();
        if (ms <= nowMs) continue;
        if (!bookedMs.has(ms)) {
          plan.push({
            postId: issue.postId,
            from: issue.scheduledFor,
            to: iso,
            reason: issue.issue,
          });
          bookedMs.add(ms);
          found = true;
          break;
        }
      }
    }
  }

  if (execute && plan.length > 0) {
    const client = getClient();
    for (const move of plan) {
      await client.updatePost(move.postId, { scheduledFor: move.to });
      await new Promise(r => setTimeout(r, 300));
    }
    return { plan, executed: true };
  }

  return { plan, executed: false };
}
