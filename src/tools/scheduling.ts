import { server } from '../mcpServer.js';
import { getClient, unwrap, toApiPlatform, toDisplayPlatform } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { loadScheduleConfig, getSlotsForPlatform, normalizePlatform } from '../config/scheduleConfig.js';
import { z } from 'zod';
import type { DayOfWeek } from '../types/schedule.js';

// ── Timezone helpers ──

function getNowInTimezone(timezone: string): string {
  return new Date().toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T');
}

function getDateStringInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString('sv-SE', { timeZone: timezone });
}

function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const dayStr = date
    .toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' })
    .toLowerCase()
    .substring(0, 3);
  return dayStr as DayOfWeek;
}

function formatDateTimeInTimezone(date: Date, timezone: string): string {
  return date.toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T');
}

/**
 * Convert a local date string + time in a timezone to a UTC Date.
 * Uses Intl offset calculation to avoid external dependencies.
 */
function createSlotDate(baseDate: Date, time: string, timezone: string): Date {
  const dateStr = getDateStringInTimezone(baseDate, timezone);
  const asUtc = new Date(`${dateStr}T${time}:00Z`);
  const inTz = asUtc.toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T');
  const inTzAsUtc = new Date(inTz + 'Z');
  const offset = asUtc.getTime() - inTzAsUtc.getTime();
  return new Date(asUtc.getTime() + offset);
}

// ── Tool 1: schedule_post ──

server.tool(
  'schedule_post',
  'Update a post with a new scheduled time',
  {
    postId: z.string().describe('The ID of the post to schedule'),
    scheduledFor: z.string().describe('ISO 8601 datetime for when to schedule the post'),
  },
  async ({ postId, scheduledFor }) => {
    try {
      unwrap(
        await getClient().sdk.posts.updatePost({
          path: { postId },
          body: { scheduledFor },
        }),
      );
      return textResponse(`✅ Post ${postId} scheduled for ${scheduledFor}`);
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to schedule post');
    }
  },
);

// ── Tool 2: find_next_slot ──

server.tool(
  'find_next_slot',
  'Find the next available schedule slot for a platform based on the schedule config',
  {
    platform: z.string().describe('Target platform (e.g., youtube, tiktok, instagram, x)'),
    clipType: z.string().optional().describe('Optional clip type for platform-specific scheduling'),
  },
  async ({ platform, clipType }) => {
    try {
      const config = loadScheduleConfig();
      if (!config) {
        return errorResponse('No schedule config found. Create a schedule.json file first.');
      }

      const normalized = normalizePlatform(platform, config);
      const slots = getSlotsForPlatform(config, normalized, clipType);
      if (slots.length === 0) {
        return errorResponse(`No schedule slots configured for platform "${platform}".`);
      }

      // Determine avoidDays for the platform/clipType combo
      const platConfig = config.platforms[normalized];
      let avoidDays: DayOfWeek[] = platConfig?.avoidDays ?? [];
      if (clipType && platConfig?.byClipType?.[clipType]) {
        avoidDays = platConfig.byClipType[clipType].avoidDays;
      }

      // Sort slots by time so we find the earliest available first
      const sortedSlots = [...slots].sort((a, b) => a.time.localeCompare(b.time));

      // Fetch existing scheduled posts to check for conflicts
      const apiPlatform = toApiPlatform(normalized);
      const scheduledResult = await getClient().sdk.posts.listPosts({
        query: { status: 'scheduled', platform: apiPlatform, limit: 100 },
      });
      const scheduledPosts = unwrap(scheduledResult);
      const postList: Array<{ scheduledFor?: string | null; content?: string }> = Array.isArray(
        scheduledPosts,
      )
        ? scheduledPosts
        : ((scheduledPosts as Record<string, unknown>)?.data as typeof postList) ?? [];

      // Build set of booked time keys ("YYYY-MM-DDTHH:MM") in config timezone
      const bookedTimes = new Set<string>();
      for (const post of postList) {
        if (post.scheduledFor) {
          const localStr = formatDateTimeInTimezone(new Date(post.scheduledFor), config.timezone);
          bookedTimes.add(localStr.substring(0, 16));
        }
      }

      // Generate candidate slot datetimes for the next 30 unique calendar days
      const now = new Date();
      const nowStr = getNowInTimezone(config.timezone);
      const processedDates = new Set<string>();

      interface SlotCandidate {
        datetime: Date;
        localStr: string;
        label: string;
      }

      let foundSlot: SlotCandidate | null = null;

      // Iterate extra days to handle potential DST skips
      for (let d = 0; d < 45 && !foundSlot; d++) {
        const candidateBase = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
        const dateStr = getDateStringInTimezone(candidateBase, config.timezone);

        if (processedDates.has(dateStr)) continue;
        processedDates.add(dateStr);
        if (processedDates.size > 30) break;

        const dow = getDayOfWeekInTimezone(candidateBase, config.timezone);

        // Skip avoided days
        if (avoidDays.includes(dow)) continue;

        for (const slot of sortedSlots) {
          if (!slot.days.includes(dow)) continue;

          const slotLocalStr = `${dateStr}T${slot.time}`;

          // Skip slots in the past
          if (slotLocalStr <= nowStr.substring(0, 16)) continue;

          // Skip booked slots
          if (bookedTimes.has(slotLocalStr)) continue;

          foundSlot = {
            datetime: createSlotDate(candidateBase, slot.time, config.timezone),
            localStr: slotLocalStr,
            label: slot.label,
          };
          break;
        }
      }

      if (!foundSlot) {
        return errorResponse('No available slots found in the next 30 days.');
      }

      // Find other posts scheduled on the same day
      const foundDatePrefix = foundSlot.localStr.substring(0, 10);
      const nearbyPosts: Array<{ time: string; content: string }> = [];
      for (const post of postList) {
        if (post.scheduledFor) {
          const postLocal = formatDateTimeInTimezone(
            new Date(post.scheduledFor),
            config.timezone,
          );
          if (postLocal.startsWith(foundDatePrefix)) {
            nearbyPosts.push({
              time: postLocal.substring(11, 16),
              content: (post.content ?? '').substring(0, 80),
            });
          }
        }
      }

      const displayPlatform = toDisplayPlatform(normalized);
      const lines = [
        `🕐 Next available slot for ${displayPlatform}${clipType ? ` (${clipType})` : ''}:`,
        '',
        `  Time:  ${foundSlot.localStr.replace('T', ' ')} (${config.timezone})`,
        `  Label: ${foundSlot.label}`,
        `  ISO:   ${foundSlot.datetime.toISOString()}`,
      ];

      if (nearbyPosts.length > 0) {
        nearbyPosts.sort((a, b) => a.time.localeCompare(b.time));
        lines.push('', '📅 Other posts scheduled that day:');
        for (const p of nearbyPosts) {
          lines.push(`  • ${p.time} — ${p.content || '(no content)'}`);
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to find next slot');
    }
  },
);

// ── Tool 3: view_calendar ──

server.tool(
  'view_calendar',
  'View a calendar of scheduled posts grouped by date',
  {
    days: z.number().optional().describe('Number of days to look ahead (default: 7)'),
  },
  async ({ days }) => {
    try {
      const lookAhead = days ?? 7;

      const result = await getClient().sdk.posts.listPosts({
        query: { status: 'scheduled', limit: 200 },
      });
      const allPosts = unwrap(result);
      const postList: Array<{
        scheduledFor?: string | null;
        content?: string;
        platforms?: string[];
      }> = Array.isArray(allPosts)
        ? allPosts
        : ((allPosts as Record<string, unknown>)?.data as typeof postList) ?? [];

      const config = loadScheduleConfig();
      const timezone = config?.timezone ?? 'UTC';

      const now = new Date();
      const cutoff = new Date(now.getTime() + lookAhead * 24 * 60 * 60 * 1000);

      // Group posts by date in config timezone
      const grouped = new Map<
        string,
        Array<{ time: string; platform: string; content: string }>
      >();

      for (const post of postList) {
        if (!post.scheduledFor) continue;

        const postDate = new Date(post.scheduledFor);
        if (postDate < now || postDate > cutoff) continue;

        const localStr = formatDateTimeInTimezone(postDate, timezone);
        const dateKey = localStr.substring(0, 10);
        const timeStr = localStr.substring(11, 16);

        const platforms = Array.isArray(post.platforms)
          ? post.platforms.map((p: string) => toDisplayPlatform(p)).join(', ')
          : 'unknown';

        const content = (post.content ?? '').substring(0, 80);

        if (!grouped.has(dateKey)) grouped.set(dateKey, []);
        grouped.get(dateKey)!.push({ time: timeStr, platform: platforms, content });
      }

      if (grouped.size === 0) {
        return textResponse(`📅 No scheduled posts in the next ${lookAhead} days.`);
      }

      const sortedDates = [...grouped.keys()].sort();
      const lines = [`📅 Scheduled Posts — Next ${lookAhead} Days (${timezone})`, ''];

      for (const date of sortedDates) {
        const dayEntries = grouped.get(date)!;
        dayEntries.sort((a, b) => a.time.localeCompare(b.time));

        const dateObj = new Date(date + 'T12:00:00Z');
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        lines.push(`── ${date} (${dayName}) ──`);

        for (const entry of dayEntries) {
          const preview = entry.content || '(no content)';
          lines.push(`  ${entry.time}  [${entry.platform}]  ${preview}`);
        }
        lines.push('');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to view calendar');
    }
  },
);

// ── Tool 4: view_schedule_config ──

server.tool(
  'view_schedule_config',
  'View the schedule configuration for posting times',
  {
    platform: z.string().optional().describe('Filter to a specific platform'),
  },
  async ({ platform }) => {
    try {
      const config = loadScheduleConfig();
      if (!config) {
        return errorResponse('No schedule config found. Create a schedule.json file first.');
      }

      const lines = [`⚙️ Schedule Config (Timezone: ${config.timezone})`, ''];

      const platformNames = platform
        ? [normalizePlatform(platform, config)]
        : Object.keys(config.platforms);

      for (const name of platformNames) {
        const platConfig = config.platforms[name];
        if (!platConfig) {
          if (platform) {
            return errorResponse(`Platform "${platform}" not found in schedule config.`);
          }
          continue;
        }

        lines.push(`📱 ${toDisplayPlatform(name).toUpperCase()}`);
        if (platConfig.avoidDays.length > 0) {
          lines.push(`  Avoid days: ${platConfig.avoidDays.join(', ')}`);
        }
        lines.push('');

        lines.push('  Slots:');
        lines.push(`  ${'Time'.padEnd(8)} ${'Days'.padEnd(28)} Label`);
        lines.push(`  ${'─'.repeat(8)} ${'─'.repeat(28)} ${'─'.repeat(20)}`);
        for (const slot of platConfig.slots) {
          lines.push(
            `  ${slot.time.padEnd(8)} ${slot.days.join(', ').padEnd(28)} ${slot.label}`,
          );
        }
        lines.push('');

        if (platConfig.byClipType) {
          for (const [clipType, clipConfig] of Object.entries(platConfig.byClipType)) {
            lines.push(`  📎 Clip Type: ${clipType}`);
            if (clipConfig.avoidDays.length > 0) {
              lines.push(`    Avoid days: ${clipConfig.avoidDays.join(', ')}`);
            }
            lines.push(`    ${'Time'.padEnd(8)} ${'Days'.padEnd(28)} Label`);
            lines.push(`    ${'─'.repeat(8)} ${'─'.repeat(28)} ${'─'.repeat(20)}`);
            for (const slot of clipConfig.slots) {
              lines.push(
                `    ${slot.time.padEnd(8)} ${slot.days.join(', ').padEnd(28)} ${slot.label}`,
              );
            }
            lines.push('');
          }
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to view schedule config');
    }
  },
);
