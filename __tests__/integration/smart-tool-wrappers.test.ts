import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

let mockClient: MockLateApiClient;

// ---------------------------------------------------------------------------
// Mock ALL dependencies BEFORE any imports that touch them
// ---------------------------------------------------------------------------

vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

vi.mock('../../src/smart/realignment.js', () => ({
  buildRealignPlan: vi.fn(),
  executeRealignPlan: vi.fn(),
}));

vi.mock('../../src/smart/prioritizedRealignment.js', () => ({
  buildPrioritizedRealignPlan: vi.fn(),
}));

vi.mock('../../src/smart/scheduler.js', () => ({
  detectConflicts: vi.fn(),
  autoResolveConflicts: vi.fn(),
  generateSlots: vi.fn(),
  buildSlotDatetime: vi.fn(),
  getDayOfWeekInTimezone: vi.fn(),
  findNextAvailableSlot: vi.fn(),
}));

vi.mock('../../src/smart/optimizer.js', () => ({
  getBestTimesToPost: vi.fn(),
  getPostingFrequency: vi.fn(),
  getContentDecay: vi.fn(),
}));

vi.mock('../../src/config/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn(),
  getSlotsForPlatform: vi.fn(),
  normalizePlatform: vi.fn((p: string) => p),
  validateScheduleConfig: vi.fn(() => []),
}));

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(() => mockClient),
  toApiPlatform: vi.fn((p: string) => p),
  toDisplayPlatform: vi.fn((p: string) => p),
  resetClient: vi.fn(),
  LateApiClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules
// ---------------------------------------------------------------------------

import { server } from '../../src/mcpServer.js';
import { buildRealignPlan, executeRealignPlan } from '../../src/smart/realignment.js';
import { buildPrioritizedRealignPlan } from '../../src/smart/prioritizedRealignment.js';
import { detectConflicts, autoResolveConflicts } from '../../src/smart/scheduler.js';
import { getBestTimesToPost, getPostingFrequency, getContentDecay } from '../../src/smart/optimizer.js';
import { loadScheduleConfig } from '../../src/config/scheduleConfig.js';

import { registerRealignTools } from '../../src/tools/smart/realign.js';
import { registerRescheduleTools } from '../../src/tools/smart/reschedule.js';
import { registerOptimizeTools } from '../../src/tools/smart/optimize.js';

// ---------------------------------------------------------------------------
// Capture tool handlers via server.tool spy
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const toolHandlers = new Map<string, ToolHandler>();

beforeEach(() => {
  vi.clearAllMocks();
  toolHandlers.clear();
  mockClient = createMockClient();

  vi.mocked(server.tool).mockImplementation(
    (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      toolHandlers.set(name, handler);
    },
  );

  registerRealignTools();
  registerRescheduleTools();
  registerOptimizeTools();
});

function getHandler(name: string): ToolHandler {
  const h = toolHandlers.get(name);
  if (!h) throw new Error(`Tool "${name}" was not registered`);
  return h;
}

function responseText(res: { content: Array<{ type: string; text: string }> }): string {
  return res.content.map(c => c.text).join('');
}

// ===========================================================================
//  REGISTRATION
// ===========================================================================

describe('tool registration', () => {
  it('registers all 7 expected tools', () => {
    const expected = [
      'realign_schedule',
      'prioritized_realign',
      'check_realign_status',
      'smart_reschedule',
      'get_best_times',
      'get_posting_frequency',
      'get_content_decay',
    ];
    for (const name of expected) {
      expect(toolHandlers.has(name)).toBe(true);
    }
  });
});

// ===========================================================================
//  realign_schedule
// ===========================================================================

describe('realign_schedule', () => {
  it('returns compact message when no posts need realignment', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 5,
    });

    const res = await getHandler('realign_schedule')({ platform: 'x', execute: false });
    expect(responseText(res)).toContain('No posts need realignment');
    expect(res.isError).toBeUndefined();
  });

  it('shows preview plan in dry-run mode', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [
        { postId: 'p1', platform: 'x', clipType: 'short', content: 'Hello', oldScheduledFor: '2025-01-01T10:00:00', newScheduledFor: '2025-01-02T10:00:00' },
      ],
      toCancel: [
        { postId: 'p2', platform: 'x', clipType: 'short', content: 'Bye', reason: 'no slot' },
      ],
      skipped: 2,
      unmatched: 0,
      totalFetched: 5,
    });

    const res = await getHandler('realign_schedule')({ execute: false });
    const text = responseText(res);
    expect(text).toContain('Realignment Plan');
    expect(text).toContain('To move: 1');
    expect(text).toContain('To cancel: 1');
    expect(text).toContain('"Hello"');
    expect(text).toContain('"Bye"');
    expect(text).toContain('no slot');
    expect(text).toContain('To execute this plan');
  });

  it('truncates cancellation list when >10 items', async () => {
    const toCancel = Array.from({ length: 12 }, (_, i) => ({
      postId: `c${i}`,
      platform: 'x',
      clipType: 'short',
      content: `Cancel ${i}`,
      reason: 'overflow',
    }));

    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'A', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel,
      skipped: 0,
      unmatched: 0,
      totalFetched: 13,
    });

    const text = responseText(await getHandler('realign_schedule')({ execute: false }));
    expect(text).toContain('... and 2 more');
  });

  it('truncates post list when >15 items', async () => {
    const posts = Array.from({ length: 17 }, (_, i) => ({
      postId: `p${i}`,
      platform: 'x',
      clipType: 'short',
      content: `Post ${i}`,
      oldScheduledFor: null,
      newScheduledFor: '2025-01-01T10:00:00',
    }));

    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts,
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 17,
    });

    const text = responseText(await getHandler('realign_schedule')({ execute: false }));
    expect(text).toContain('... and 2 more');
  });

  it('executes plan when execute=true', async () => {
    const plan = {
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'Go', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };
    vi.mocked(buildRealignPlan).mockResolvedValue(plan);
    vi.mocked(executeRealignPlan).mockResolvedValue({
      updated: 1,
      cancelled: 0,
      failed: 0,
      errors: [],
    });

    const text = responseText(await getHandler('realign_schedule')({ execute: true }));
    expect(text).toContain('Realignment complete');
    expect(text).toContain('Updated: 1');
    expect(executeRealignPlan).toHaveBeenCalledWith(plan);
  });

  it('shows errors from execution result', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'Go', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    });
    vi.mocked(executeRealignPlan).mockResolvedValue({
      updated: 0,
      cancelled: 0,
      failed: 1,
      errors: [{ postId: 'p1', error: 'API timeout' }],
    });

    const text = responseText(await getHandler('realign_schedule')({ execute: true }));
    expect(text).toContain('Failed: 1');
    expect(text).toContain('API timeout');
  });

  it('returns error response when buildRealignPlan throws', async () => {
    vi.mocked(buildRealignPlan).mockRejectedValue(new Error('network down'));
    const res = await getHandler('realign_schedule')({ execute: false });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('network down');
  });

  it('returns error response when executeRealignPlan throws', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'X', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    });
    vi.mocked(executeRealignPlan).mockRejectedValue(new Error('write fail'));
    const res = await getHandler('realign_schedule')({ execute: true });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('write fail');
  });

  it('passes platform and clipType filters to buildRealignPlan', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 });
    await getHandler('realign_schedule')({ platform: 'instagram', clipType: 'video' });
    expect(buildRealignPlan).toHaveBeenCalledWith({ platform: 'instagram', clipType: 'video' });
  });

  it('shows "unscheduled" for posts with null oldScheduledFor', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'Hi', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    });
    const text = responseText(await getHandler('realign_schedule')({ execute: false }));
    expect(text).toContain('unscheduled');
  });
});

// ===========================================================================
//  prioritized_realign
// ===========================================================================

describe('prioritized_realign', () => {
  const priorities = [
    { keywords: ['urgent'], saturation: 0.8 },
    { keywords: ['low'], saturation: 0.2, from: '2025-01-01', to: '2025-06-30' },
  ];

  it('returns message when no posts need realignment', async () => {
    vi.mocked(buildPrioritizedRealignPlan).mockResolvedValue({
      posts: [],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 3,
    });

    const text = responseText(await getHandler('prioritized_realign')({ priorities, execute: false }));
    expect(text).toContain('No posts need realignment');
  });

  it('shows preview with priority rules', async () => {
    vi.mocked(buildPrioritizedRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'urgent post', oldScheduledFor: '2025-01-01T08:00:00', newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 1,
      unmatched: 0,
      totalFetched: 2,
    });

    const text = responseText(await getHandler('prioritized_realign')({ priorities, execute: false }));
    expect(text).toContain('Prioritized Realignment Plan');
    expect(text).toContain('urgent');
    expect(text).toContain('80% saturation');
    expect(text).toContain('from 2025-01-01');
    expect(text).toContain('to 2025-06-30');
    expect(text).toContain('To execute');
  });

  it('truncates post list when >15 items', async () => {
    const posts = Array.from({ length: 18 }, (_, i) => ({
      postId: `p${i}`,
      platform: 'x',
      clipType: 'short',
      content: `Post ${i}`,
      oldScheduledFor: null,
      newScheduledFor: '2025-01-01T10:00:00',
    }));
    vi.mocked(buildPrioritizedRealignPlan).mockResolvedValue({
      posts,
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 18,
    });

    const text = responseText(await getHandler('prioritized_realign')({ priorities, execute: false }));
    expect(text).toContain('... and 3 more');
  });

  it('executes prioritized realign', async () => {
    const plan = {
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'A', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    };
    vi.mocked(buildPrioritizedRealignPlan).mockResolvedValue(plan);
    vi.mocked(executeRealignPlan).mockResolvedValue({ updated: 1, cancelled: 0, failed: 0, errors: [] });

    const text = responseText(await getHandler('prioritized_realign')({ priorities, execute: true }));
    expect(text).toContain('Prioritized realignment complete');
    expect(text).toContain('Updated: 1');
    expect(executeRealignPlan).toHaveBeenCalledWith(plan);
  });

  it('returns error response when buildPrioritizedRealignPlan throws', async () => {
    vi.mocked(buildPrioritizedRealignPlan).mockRejectedValue(new Error('bad rules'));
    const res = await getHandler('prioritized_realign')({ priorities, execute: false });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('bad rules');
  });

  it('passes platform, clipType, and priorities to buildPrioritizedRealignPlan', async () => {
    vi.mocked(buildPrioritizedRealignPlan).mockResolvedValue({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 });
    await getHandler('prioritized_realign')({ platform: 'youtube', clipType: 'video', priorities });
    expect(buildPrioritizedRealignPlan).toHaveBeenCalledWith({
      priorities,
      platform: 'youtube',
      clipType: 'video',
    });
  });
});

// ===========================================================================
//  check_realign_status
// ===========================================================================

describe('check_realign_status', () => {
  it('returns error for unknown plan ID', async () => {
    const res = await getHandler('check_realign_status')({ planId: 'nope', execute: false });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('No plan found');
  });

  it('returns status of a stored plan (preview)', async () => {
    // First create a plan via realign_schedule (preview mode)
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'Test', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [{ postId: 'c1', platform: 'x', clipType: 'short', content: 'Drop', reason: 'extra' }],
      skipped: 0,
      unmatched: 0,
      totalFetched: 2,
    });
    const previewText = responseText(await getHandler('realign_schedule')({ execute: false }));
    const planIdMatch = previewText.match(/ID: (realign-\d+)/);
    expect(planIdMatch).not.toBeNull();
    const planId = planIdMatch![1];

    const res = await getHandler('check_realign_status')({ planId, execute: false });
    const text = responseText(res);
    expect(text).toContain('is ready');
    expect(text).toContain('Posts to move: 1');
    expect(text).toContain('To cancel: 1');
  });

  it('executes a stored plan and removes it', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'Go', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    });
    const previewText = responseText(await getHandler('realign_schedule')({ execute: false }));
    const planId = previewText.match(/ID: (realign-\d+)/)![1];

    vi.mocked(executeRealignPlan).mockResolvedValue({ updated: 1, cancelled: 0, failed: 0, errors: [] });

    const res = await getHandler('check_realign_status')({ planId, execute: true });
    expect(responseText(res)).toContain('executed');
    expect(responseText(res)).toContain('Updated: 1');

    // Plan should be removed
    const gone = await getHandler('check_realign_status')({ planId, execute: false });
    expect(gone.isError).toBe(true);
  });

  it('returns error response when executeRealignPlan throws', async () => {
    vi.mocked(buildRealignPlan).mockResolvedValue({
      posts: [{ postId: 'p1', platform: 'x', clipType: 'short', content: 'X', oldScheduledFor: null, newScheduledFor: '2025-01-01T10:00:00' }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    });
    const previewText = responseText(await getHandler('realign_schedule')({ execute: false }));
    const planId = previewText.match(/ID: (realign-\d+)/)![1];

    vi.mocked(executeRealignPlan).mockRejectedValue(new Error('API down'));
    const res = await getHandler('check_realign_status')({ planId, execute: true });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('API down');
  });
});

// ===========================================================================
//  smart_reschedule
// ===========================================================================

describe('smart_reschedule', () => {
  it('returns success when no conflicts exist', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({ conflicts: [], outOfWindow: [] });
    const text = responseText(await getHandler('smart_reschedule')({ execute: false }));
    expect(text).toContain('No scheduling conflicts');
  });

  it('shows conflict report in preview mode', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({
      conflicts: [
        { postId: 'p1', scheduledFor: '2025-01-01T10:00:00', platform: 'x', content: 'Dup1', issue: 'duplicate time' },
      ],
      outOfWindow: [
        { postId: 'p2', scheduledFor: '2025-01-01T03:00:00', platform: 'x', content: 'Late', issue: 'outside window' },
      ],
    });

    const text = responseText(await getHandler('smart_reschedule')({ execute: false }));
    expect(text).toContain('Conflict Report');
    expect(text).toContain('Time conflicts (1 posts)');
    expect(text).toContain('duplicate time');
    expect(text).toContain('Out-of-window posts (1)');
    expect(text).toContain('outside window');
    expect(text).toContain('execute=true');
  });

  it('truncates conflicts when >10 items', async () => {
    const conflicts = Array.from({ length: 13 }, (_, i) => ({
      postId: `p${i}`,
      scheduledFor: '2025-01-01T10:00:00',
      platform: 'x',
      content: `Conflict ${i}`,
      issue: 'dup',
    }));
    vi.mocked(detectConflicts).mockResolvedValue({ conflicts, outOfWindow: [] });

    const text = responseText(await getHandler('smart_reschedule')({ execute: false }));
    expect(text).toContain('... and 3 more');
  });

  it('truncates out-of-window when >10 items', async () => {
    const outOfWindow = Array.from({ length: 11 }, (_, i) => ({
      postId: `o${i}`,
      scheduledFor: '2025-01-01T03:00:00',
      platform: 'x',
      content: `OOW ${i}`,
      issue: 'bad',
    }));
    vi.mocked(detectConflicts).mockResolvedValue({ conflicts: [], outOfWindow });

    const text = responseText(await getHandler('smart_reschedule')({ execute: false }));
    expect(text).toContain('... and 1 more');
  });

  it('auto-resolves conflicts when execute=true', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({
      conflicts: [{ postId: 'p1', scheduledFor: '2025-01-01T10:00:00', platform: 'x', content: 'Dup', issue: 'dup' }],
      outOfWindow: [],
    });
    vi.mocked(autoResolveConflicts).mockResolvedValue({
      plan: [{ postId: 'p1', from: '2025-01-01T10:00:00', to: '2025-01-01T14:00:00', reason: 'moved to next slot' }],
      executed: true,
    });

    const text = responseText(await getHandler('smart_reschedule')({ execute: true }));
    expect(text).toContain('Auto-resolved 1 conflicts');
    expect(text).toContain('moved to next slot');
    expect(autoResolveConflicts).toHaveBeenCalledWith(undefined, true);
  });

  it('passes platform filter to detectConflicts and autoResolveConflicts', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({
      conflicts: [{ postId: 'p1', scheduledFor: '2025-01-01T10:00:00', platform: 'instagram', content: 'X', issue: 'dup' }],
      outOfWindow: [],
    });
    vi.mocked(autoResolveConflicts).mockResolvedValue({
      plan: [{ postId: 'p1', from: 'a', to: 'b', reason: 'move' }],
      executed: true,
    });

    await getHandler('smart_reschedule')({ platform: 'instagram', execute: true });
    expect(detectConflicts).toHaveBeenCalledWith('instagram');
    expect(autoResolveConflicts).toHaveBeenCalledWith('instagram', true);
  });

  it('returns message when auto-resolve finds no available slots', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({
      conflicts: [{ postId: 'p1', scheduledFor: '2025-01-01T10:00:00', platform: 'x', content: 'X', issue: 'dup' }],
      outOfWindow: [],
    });
    vi.mocked(autoResolveConflicts).mockResolvedValue({ plan: [], executed: false });

    const text = responseText(await getHandler('smart_reschedule')({ execute: true }));
    expect(text).toContain('No conflicts could be auto-resolved');
  });

  it('truncates auto-resolve plan when >15 moves', async () => {
    vi.mocked(detectConflicts).mockResolvedValue({
      conflicts: [{ postId: 'p1', scheduledFor: '2025-01-01T10:00:00', platform: 'x', content: 'X', issue: 'dup' }],
      outOfWindow: [],
    });
    const plan = Array.from({ length: 18 }, (_, i) => ({
      postId: `p${i}`,
      from: '2025-01-01T10:00:00',
      to: '2025-01-02T10:00:00',
      reason: 'moved',
    }));
    vi.mocked(autoResolveConflicts).mockResolvedValue({ plan, executed: true });

    const text = responseText(await getHandler('smart_reschedule')({ execute: true }));
    expect(text).toContain('... and 3 more');
  });

  it('returns error response on failure', async () => {
    vi.mocked(detectConflicts).mockRejectedValue(new Error('no config'));
    const res = await getHandler('smart_reschedule')({ execute: false });
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('no config');
  });
});

// ===========================================================================
//  get_best_times
// ===========================================================================

describe('get_best_times', () => {
  it('returns message when no data is available', async () => {
    vi.mocked(getBestTimesToPost).mockResolvedValue([]);
    const text = responseText(await getHandler('get_best_times')({ platform: 'x' }));
    expect(text).toContain('No best-time data available');
  });

  it('shows best times sorted by engagement', async () => {
    vi.mocked(getBestTimesToPost).mockResolvedValue([
      {
        platform: 'x',
        bestTimes: [
          { day: 'Mon', hour: 9, engagement: 50 },
          { day: 'Wed', hour: 14, engagement: 120 },
          { day: 'Fri', hour: 11, engagement: 80 },
        ],
      },
    ]);
    vi.mocked(loadScheduleConfig).mockReturnValue(null);

    const text = responseText(await getHandler('get_best_times')({}));
    expect(text).toContain('Best Times to Post');
    expect(text).toContain('Platform: x');
    // Verify sorted by engagement descending (120 first)
    const lines = text.split('\n');
    const engagementLines = lines.filter(l => l.includes('engagement score'));
    expect(engagementLines[0]).toContain('120');
  });

  it('shows schedule config comparison when config is available', async () => {
    vi.mocked(getBestTimesToPost).mockResolvedValue([
      {
        platform: 'x',
        bestTimes: [{ day: 'Mon', hour: 9, engagement: 100 }],
      },
    ]);
    vi.mocked(loadScheduleConfig).mockReturnValue({
      timezone: 'America/Chicago',
      platforms: {
        x: {
          slots: [
            { days: ['mon', 'wed', 'fri'], time: '09:00', label: 'Morning post' },
          ],
        },
      },
    } as ReturnType<typeof loadScheduleConfig>);

    const text = responseText(await getHandler('get_best_times')({}));
    expect(text).toContain('schedule config comparison');
    expect(text).toContain('Morning post');
  });

  it('notes when platform has no schedule configured', async () => {
    vi.mocked(getBestTimesToPost).mockResolvedValue([
      { platform: 'tiktok', bestTimes: [{ day: 'Mon', hour: 9, engagement: 50 }] },
    ]);
    vi.mocked(loadScheduleConfig).mockReturnValue({
      timezone: 'UTC',
      platforms: { x: { slots: [] } },
    } as ReturnType<typeof loadScheduleConfig>);

    const text = responseText(await getHandler('get_best_times')({}));
    expect(text).toContain('No schedule configured for this platform');
  });

  it('handles platform with empty bestTimes', async () => {
    vi.mocked(getBestTimesToPost).mockResolvedValue([
      { platform: 'x', bestTimes: [] },
    ]);
    vi.mocked(loadScheduleConfig).mockReturnValue(null);

    const text = responseText(await getHandler('get_best_times')({}));
    expect(text).toContain('No data available');
  });

  it('returns error response on failure', async () => {
    vi.mocked(getBestTimesToPost).mockRejectedValue(new Error('analytics offline'));
    const res = await getHandler('get_best_times')({});
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('analytics offline');
  });
});

// ===========================================================================
//  get_posting_frequency
// ===========================================================================

describe('get_posting_frequency', () => {
  it('returns message when no data is available', async () => {
    vi.mocked(getPostingFrequency).mockResolvedValue([]);
    const text = responseText(await getHandler('get_posting_frequency')({}));
    expect(text).toContain('No posting frequency data available');
  });

  it('displays frequency analysis', async () => {
    vi.mocked(getPostingFrequency).mockResolvedValue([
      {
        platform: 'x',
        currentFrequency: 5,
        optimalFrequency: 7,
        engagementCorrelation: 0.853,
        recommendation: 'Consider increasing from 5 to 7 posts/week',
      },
    ]);

    const text = responseText(await getHandler('get_posting_frequency')({}));
    expect(text).toContain('Posting Frequency Analysis');
    expect(text).toContain('Current: 5 posts/week');
    expect(text).toContain('Optimal: 7 posts/week');
    expect(text).toContain('85.3%');
    expect(text).toContain('Consider increasing');
  });

  it('returns error response on failure', async () => {
    vi.mocked(getPostingFrequency).mockRejectedValue(new Error('timeout'));
    const res = await getHandler('get_posting_frequency')({});
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('timeout');
  });
});

// ===========================================================================
//  get_content_decay
// ===========================================================================

describe('get_content_decay', () => {
  it('returns message when no data is available', async () => {
    vi.mocked(getContentDecay).mockResolvedValue([]);
    const text = responseText(await getHandler('get_content_decay')({}));
    expect(text).toContain('No content decay data available');
  });

  it('shows decay analysis with timeline', async () => {
    vi.mocked(getContentDecay).mockResolvedValue([
      {
        postId: 'post-1',
        platform: 'x',
        publishedAt: '2025-01-01T10:00:00Z',
        totalEngagement: 500,
        halfLifeHours: 12,
        decayPoints: [
          { hoursAfterPublish: 1, cumulativeEngagement: 200, percentOfTotal: 40 },
          { hoursAfterPublish: 6, cumulativeEngagement: 350, percentOfTotal: 70 },
          { hoursAfterPublish: 24, cumulativeEngagement: 480, percentOfTotal: 96 },
        ],
      },
    ]);

    const text = responseText(await getHandler('get_content_decay')({}));
    expect(text).toContain('Content Decay Analysis');
    expect(text).toContain('post-1');
    expect(text).toContain('Total engagement: 500');
    expect(text).toContain('Half-life: 12 hours');
    expect(text).toContain('Timeline');
    expect(text).toContain('40%');
    expect(text).toContain('█');
  });

  it('shows N/A when halfLifeHours is null', async () => {
    vi.mocked(getContentDecay).mockResolvedValue([
      {
        postId: 'post-2',
        platform: 'x',
        publishedAt: '',
        totalEngagement: 0,
        halfLifeHours: null,
        decayPoints: [],
      },
    ]);

    const text = responseText(await getHandler('get_content_decay')({}));
    expect(text).toContain('Half-life: N/A');
    expect(text).toContain('unknown');
  });

  it('passes postId and platform to getContentDecay', async () => {
    vi.mocked(getContentDecay).mockResolvedValue([]);
    await getHandler('get_content_decay')({ postId: 'abc', platform: 'youtube' });
    expect(getContentDecay).toHaveBeenCalledWith('abc', 'youtube');
  });

  it('truncates decay points to 8 entries', async () => {
    const decayPoints = Array.from({ length: 12 }, (_, i) => ({
      hoursAfterPublish: i * 2,
      cumulativeEngagement: i * 50,
      percentOfTotal: i * 8,
    }));
    vi.mocked(getContentDecay).mockResolvedValue([
      {
        postId: 'big',
        platform: 'x',
        publishedAt: '2025-01-01T10:00:00Z',
        totalEngagement: 600,
        halfLifeHours: 10,
        decayPoints,
      },
    ]);

    const text = responseText(await getHandler('get_content_decay')({}));
    // Should show at most 8 timeline entries
    const timelineLines = text.split('\n').filter(l => l.includes('h:'));
    expect(timelineLines.length).toBeLessThanOrEqual(8);
  });

  it('returns error response on failure', async () => {
    vi.mocked(getContentDecay).mockRejectedValue(new Error('no access'));
    const res = await getHandler('get_content_decay')({});
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('no access');
  });

  it('handles non-Error thrown values', async () => {
    vi.mocked(getContentDecay).mockRejectedValue('string error');
    const res = await getHandler('get_content_decay')({});
    expect(res.isError).toBe(true);
    expect(responseText(res)).toContain('string error');
  });
});
