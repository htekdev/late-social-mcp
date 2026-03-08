import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

let mockClient: MockLateApiClient;

vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(() => mockClient),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
  resetClient: vi.fn(),
  LateApiClient: vi.fn(),
}));

import { server } from '../../src/mcpServer.js';

await import('../../src/tools/queue.js');

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function getToolHandler(toolName: string): ToolHandler {
  const handler = toolHandlers.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not registered`);
  return handler;
}

// ── Registration ──

describe('queue tools registration', () => {
  it('registers all five queue tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('list_queues');
    expect(names).toContain('create_queue');
    expect(names).toContain('update_queue');
    expect(names).toContain('delete_queue');
    expect(names).toContain('preview_queue_slots');
  });
});

// ── list_queues ──

describe('list_queues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('returns formatted queue list', async () => {
    mockClient.listQueues.mockResolvedValue([
      {
        id: 'q1',
        name: 'Weekday Mornings',
        isDefault: true,
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        times: ['09:00', '12:00'],
      },
      {
        id: 'q2',
        name: 'Weekend',
        isDefault: false,
        days: ['sat', 'sun'],
        times: ['10:00'],
      },
    ]);

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Queue Schedules');
    expect(result.content[0].text).toContain('Weekday Mornings');
    expect(result.content[0].text).toContain('q1');
    expect(result.content[0].text).toContain('Default');
    expect(result.content[0].text).toContain('Weekend');
  });

  it('shows days and times in queue listing', async () => {
    mockClient.listQueues.mockResolvedValue([
      { id: 'q1', name: 'Test', days: ['mon', 'wed'], times: ['08:00', '16:00'] },
    ]);

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'prof1' });

    expect(result.content[0].text).toContain('mon');
    expect(result.content[0].text).toContain('wed');
    expect(result.content[0].text).toContain('08:00');
    expect(result.content[0].text).toContain('16:00');
  });

  it('returns empty message when no queues exist', async () => {
    mockClient.listQueues.mockResolvedValue([]);

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No queue schedules found');
  });

  it('returns error on SDK failure', async () => {
    mockClient.listQueues.mockRejectedValue(new Error('Profile not found'));

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'bad-prof' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Profile not found');
  });
});

// ── create_queue ──

describe('create_queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('creates a queue with days and times', async () => {
    const handler = getToolHandler('create_queue');
    const result = await handler({
      profileId: 'prof1',
      name: 'Morning Queue',
      days: 'mon,tue,wed,thu,fri',
      times: '09:00,12:00',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Queue created successfully');
    expect(result.content[0].text).toContain('Morning Queue');
    expect(result.content[0].text).toContain('mon');
    expect(result.content[0].text).toContain('09:00');
  });

  it('passes correct body to client', async () => {
    const handler = getToolHandler('create_queue');
    await handler({
      profileId: 'prof1',
      name: 'Test',
      days: 'mon,wed,fri',
      times: '10:00,15:00',
      setAsDefault: true,
    });

    expect(mockClient.createQueue).toHaveBeenCalledWith({
      profileId: 'prof1',
      name: 'Test',
      days: ['mon', 'wed', 'fri'],
      times: ['10:00', '15:00'],
      setAsDefault: true,
    });
  });

  it('marks default queue in output', async () => {
    const handler = getToolHandler('create_queue');
    const result = await handler({
      profileId: 'prof1',
      days: 'mon',
      times: '09:00',
      setAsDefault: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('default');
  });

  it('returns error when days list is empty', async () => {
    const handler = getToolHandler('create_queue');
    const result = await handler({
      profileId: 'prof1',
      days: '',
      times: '09:00',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('day');
  });

  it('returns error when times list is empty', async () => {
    const handler = getToolHandler('create_queue');
    const result = await handler({
      profileId: 'prof1',
      days: 'mon',
      times: '',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('time');
  });

  it('returns error on SDK failure', async () => {
    mockClient.createQueue.mockRejectedValue(new Error('Quota exceeded'));

    const handler = getToolHandler('create_queue');
    const result = await handler({
      profileId: 'prof1',
      days: 'mon',
      times: '09:00',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Quota exceeded');
  });
});

// ── update_queue ──

describe('update_queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('updates queue name successfully', async () => {
    const handler = getToolHandler('update_queue');
    const result = await handler({
      profileId: 'prof1',
      queueId: 'q1',
      name: 'Renamed Queue',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Queue updated successfully');
    expect(result.content[0].text).toContain('Renamed Queue');
  });

  it('updates days and times', async () => {
    const handler = getToolHandler('update_queue');
    const result = await handler({
      profileId: 'prof1',
      queueId: 'q1',
      days: 'mon,wed,fri',
      times: '10:00,15:00',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('mon');
    expect(result.content[0].text).toContain('10:00');
  });

  it('returns error when days string results in empty list', async () => {
    const handler = getToolHandler('update_queue');
    const result = await handler({
      profileId: 'prof1',
      queueId: 'q1',
      days: '   ',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Days list cannot be empty');
  });

  it('returns error when times string results in empty list', async () => {
    const handler = getToolHandler('update_queue');
    const result = await handler({
      profileId: 'prof1',
      queueId: 'q1',
      times: '  ,  ',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Times list cannot be empty');
  });

  it('returns error on SDK failure', async () => {
    mockClient.updateQueue.mockRejectedValue(new Error('Queue not found'));

    const handler = getToolHandler('update_queue');
    const result = await handler({
      profileId: 'prof1',
      queueId: 'bad-q',
      name: 'X',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Queue not found');
  });
});

// ── delete_queue ──

describe('delete_queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('deletes a queue successfully', async () => {
    const handler = getToolHandler('delete_queue');
    const result = await handler({ profileId: 'prof1', queueId: 'q1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('deleted successfully');
    expect(result.content[0].text).toContain('q1');
  });

  it('calls client with correct positional parameters', async () => {
    const handler = getToolHandler('delete_queue');
    await handler({ profileId: 'prof1', queueId: 'q99' });

    expect(mockClient.deleteQueue).toHaveBeenCalledWith('prof1', 'q99');
  });

  it('returns error on SDK failure', async () => {
    mockClient.deleteQueue.mockRejectedValue(new Error('Forbidden'));

    const handler = getToolHandler('delete_queue');
    const result = await handler({ profileId: 'prof1', queueId: 'q1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden');
  });
});

// ── preview_queue_slots ──

describe('preview_queue_slots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
  });

  it('previews upcoming queue slots', async () => {
    mockClient.previewQueueSlots.mockResolvedValue([
      { datetime: '2025-06-16T09:00:00Z' },
      { datetime: '2025-06-16T12:00:00Z' },
      { datetime: '2025-06-17T09:00:00Z' },
    ]);

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Queue Slots');
    expect(result.content[0].text).toContain('2025-06-16T09:00:00Z');
    expect(result.content[0].text).toContain('2025-06-17T09:00:00Z');
  });

  it('respects custom count parameter', async () => {
    mockClient.previewQueueSlots.mockResolvedValue([{ datetime: '2025-06-16T09:00:00Z' }]);

    const handler = getToolHandler('preview_queue_slots');
    await handler({ profileId: 'prof1', count: 5 });

    expect(mockClient.previewQueueSlots).toHaveBeenCalledWith('prof1', { count: 5 });
  });

  it('passes queueId when specified', async () => {
    mockClient.previewQueueSlots.mockResolvedValue([]);

    const handler = getToolHandler('preview_queue_slots');
    await handler({ profileId: 'prof1', queueId: 'q2', count: 3 });

    expect(mockClient.previewQueueSlots).toHaveBeenCalledWith('prof1', { count: 3, queueId: 'q2' });
  });

  it('returns empty message when no slots found', async () => {
    mockClient.previewQueueSlots.mockResolvedValue([]);

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No upcoming queue slots');
  });

  it('numbers the slots sequentially', async () => {
    mockClient.previewQueueSlots.mockResolvedValue([
      { datetime: '2025-06-16T09:00:00Z' },
      { datetime: '2025-06-16T12:00:00Z' },
    ]);

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.content[0].text).toContain(' 1.');
    expect(result.content[0].text).toContain(' 2.');
  });

  it('returns error on SDK failure', async () => {
    mockClient.previewQueueSlots.mockRejectedValue(new Error('Service unavailable'));

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Service unavailable');
  });
});
