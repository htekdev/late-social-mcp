import { server } from '../server.js';
import { getClient, unwrap } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

// ── Tool 1: list_queues ──

server.tool(
  'list_queues',
  'List all queue schedules for a profile',
  {
    profileId: z.string().describe('The profile ID to list queues for'),
  },
  async ({ profileId }) => {
    try {
      const result = unwrap(
        await getClient().sdk.queue.listQueueSlots({
          query: { profileId, all: true },
        }),
      );
      const queues: Array<Record<string, unknown>> = Array.isArray(result)
        ? result
        : ((result as Record<string, unknown>)?.data as typeof queues) ?? [];

      if (queues.length === 0) {
        return textResponse('No queue schedules found for this profile.');
      }

      const lines = ['📋 Queue Schedules', ''];
      for (const q of queues) {
        lines.push(`Queue: ${q.name ?? '(unnamed)'}${q.id ? ` (ID: ${q.id})` : ''}`);
        if (q.isDefault) lines.push('  ⭐ Default queue');
        if (q.days) {
          lines.push(`  Days:  ${Array.isArray(q.days) ? q.days.join(', ') : String(q.days)}`);
        }
        if (q.times) {
          lines.push(
            `  Times: ${Array.isArray(q.times) ? q.times.join(', ') : String(q.times)}`,
          );
        }
        lines.push('');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to list queues');
    }
  },
);

// ── Tool 2: create_queue ──

server.tool(
  'create_queue',
  'Create a new queue schedule for a profile',
  {
    profileId: z.string().describe('The profile ID to create the queue for'),
    name: z.string().optional().describe('Name for the queue schedule'),
    days: z
      .string()
      .describe('Comma-separated days (e.g., "mon,tue,wed,thu,fri")'),
    times: z
      .string()
      .describe('Comma-separated times in HH:MM format (e.g., "09:00,12:00,17:00")'),
    setAsDefault: z.boolean().optional().describe('Set this queue as the default'),
  },
  async ({ profileId, name, days, times, setAsDefault }) => {
    try {
      const daysList = days
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const timesList = times
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (daysList.length === 0) return errorResponse('At least one day is required.');
      if (timesList.length === 0) return errorResponse('At least one time is required.');

      unwrap(
        await getClient().sdk.queue.createQueueSlot({
          body: {
            profileId,
            name,
            days: daysList,
            times: timesList,
            setAsDefault,
          },
        }),
      );

      const lines = [
        '✅ Queue created successfully.',
        `  Name:  ${name ?? '(unnamed)'}`,
        `  Days:  ${daysList.join(', ')}`,
        `  Times: ${timesList.join(', ')}`,
      ];
      if (setAsDefault) lines.push('  ⭐ Set as default');

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to create queue');
    }
  },
);

// ── Tool 3: update_queue ──

server.tool(
  'update_queue',
  'Update an existing queue schedule',
  {
    profileId: z.string().describe('The profile ID'),
    queueId: z.string().optional().describe('Queue ID to update (omit for default queue)'),
    name: z.string().optional().describe('New name for the queue'),
    days: z
      .string()
      .optional()
      .describe('New comma-separated days (e.g., "mon,wed,fri")'),
    times: z
      .string()
      .optional()
      .describe('New comma-separated times in HH:MM format (e.g., "10:00,15:00")'),
    setAsDefault: z.boolean().optional().describe('Set this queue as the default'),
  },
  async ({ profileId, queueId, name, days, times, setAsDefault }) => {
    try {
      const body: Record<string, unknown> = { profileId };
      if (queueId) body.queueId = queueId;
      if (name) body.name = name;
      if (setAsDefault !== undefined) body.setAsDefault = setAsDefault;

      if (days) {
        const daysList = days
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
        if (daysList.length === 0) return errorResponse('Days list cannot be empty.');
        body.days = daysList;
      }

      if (times) {
        const timesList = times
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        if (timesList.length === 0) return errorResponse('Times list cannot be empty.');
        body.times = timesList;
      }

      unwrap(
        await getClient().sdk.queue.updateQueueSlot({
          body: body as never,
        }),
      );

      const updates: string[] = [];
      if (name) updates.push(`Name: ${name}`);
      if (body.days) updates.push(`Days: ${(body.days as string[]).join(', ')}`);
      if (body.times) updates.push(`Times: ${(body.times as string[]).join(', ')}`);
      if (setAsDefault) updates.push('⭐ Set as default');

      return textResponse(
        '✅ Queue updated successfully.\n' + updates.map((u) => `  ${u}`).join('\n'),
      );
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to update queue');
    }
  },
);

// ── Tool 4: delete_queue ──

server.tool(
  'delete_queue',
  'Delete a queue schedule',
  {
    profileId: z.string().describe('The profile ID'),
    queueId: z.string().describe('The queue ID to delete'),
  },
  async ({ profileId, queueId }) => {
    try {
      unwrap(
        await getClient().sdk.queue.deleteQueueSlot({
          query: { profileId, queueId },
        }),
      );
      return textResponse(`✅ Queue ${queueId} deleted successfully.`);
    } catch (err: unknown) {
      return errorResponse(err instanceof Error ? err.message : 'Failed to delete queue');
    }
  },
);

// ── Tool 5: preview_queue_slots ──

server.tool(
  'preview_queue_slots',
  'Preview the next upcoming queue slot times',
  {
    profileId: z.string().describe('The profile ID'),
    count: z
      .number()
      .optional()
      .describe('Number of upcoming slots to preview (default: 10)'),
    queueId: z.string().optional().describe('Specific queue ID (omit for default queue)'),
  },
  async ({ profileId, count, queueId }) => {
    try {
      const slotCount = count ?? 10;

      const query: Record<string, unknown> = { profileId, count: slotCount };
      if (queueId) query.queueId = queueId;

      const result = unwrap(
        await getClient().sdk.queue.previewQueue({
          query: query as never,
        }),
      );
      const slots: Array<Record<string, unknown>> = Array.isArray(result)
        ? result
        : ((result as Record<string, unknown>)?.data as typeof slots) ?? [];

      if (slots.length === 0) {
        return textResponse('No upcoming queue slots found.');
      }

      const lines = [`🕐 Next ${slots.length} Queue Slots`, ''];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const datetime =
          slot.datetime ?? slot.scheduledFor ?? slot.time ?? JSON.stringify(slot);
        lines.push(`  ${String(i + 1).padStart(2)}. ${datetime}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(
        err instanceof Error ? err.message : 'Failed to preview queue slots',
      );
    }
  },
);
