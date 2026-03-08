import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(),
  unwrap: vi.fn((result: { data?: unknown; error?: unknown }) => {
    if (result.error) throw new Error(String(result.error));
    return result.data;
  }),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
}));

import { server } from '../../src/mcpServer.js';
import { getClient, unwrap } from '../../src/client/lateClient.js';

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

function mockSdk(overrides: Record<string, unknown> = {}) {
  const sdk = {
    queue: {
      listQueueSlots: vi.fn().mockResolvedValue({ data: [] }),
      createQueueSlot: vi.fn().mockResolvedValue({ data: {} }),
      updateQueueSlot: vi.fn().mockResolvedValue({ data: {} }),
      deleteQueueSlot: vi.fn().mockResolvedValue({ data: {} }),
      previewQueue: vi.fn().mockResolvedValue({ data: [] }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
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
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted queue list', async () => {
    const sdk = mockSdk();
    sdk.queue.listQueueSlots.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
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
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
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
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No queue schedules found');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Profile not found');
    });

    const handler = getToolHandler('list_queues');
    const result = await handler({ profileId: 'bad-prof' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Profile not found');
  });
});

// ── create_queue ──

describe('create_queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a queue with days and times', async () => {
    const sdk = mockSdk();
    sdk.queue.createQueueSlot.mockResolvedValue({ data: {} });
    vi.mocked(unwrap).mockReturnValue({});

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

  it('passes correct body to SDK', async () => {
    const sdk = mockSdk();
    sdk.queue.createQueueSlot.mockResolvedValue({ data: {} });
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('create_queue');
    await handler({
      profileId: 'prof1',
      name: 'Test',
      days: 'mon,wed,fri',
      times: '10:00,15:00',
      setAsDefault: true,
    });

    expect(sdk.queue.createQueueSlot).toHaveBeenCalledWith({
      body: {
        profileId: 'prof1',
        name: 'Test',
        days: ['mon', 'wed', 'fri'],
        times: ['10:00', '15:00'],
        setAsDefault: true,
      },
    });
  });

  it('marks default queue in output', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

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
    mockSdk();

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
    mockSdk();

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
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

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
  beforeEach(() => vi.clearAllMocks());

  it('updates queue name successfully', async () => {
    const sdk = mockSdk();
    sdk.queue.updateQueueSlot.mockResolvedValue({ data: {} });
    vi.mocked(unwrap).mockReturnValue({});

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
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

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
    mockSdk();

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
    mockSdk();

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
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Queue not found');
    });

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
  beforeEach(() => vi.clearAllMocks());

  it('deletes a queue successfully', async () => {
    const sdk = mockSdk();
    sdk.queue.deleteQueueSlot.mockResolvedValue({ data: {} });
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('delete_queue');
    const result = await handler({ profileId: 'prof1', queueId: 'q1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('deleted successfully');
    expect(result.content[0].text).toContain('q1');
  });

  it('calls SDK with correct query parameters', async () => {
    const sdk = mockSdk();
    sdk.queue.deleteQueueSlot.mockResolvedValue({ data: {} });
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('delete_queue');
    await handler({ profileId: 'prof1', queueId: 'q99' });

    expect(sdk.queue.deleteQueueSlot).toHaveBeenCalledWith({
      query: { profileId: 'prof1', queueId: 'q99' },
    });
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Forbidden');
    });

    const handler = getToolHandler('delete_queue');
    const result = await handler({ profileId: 'prof1', queueId: 'q1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden');
  });
});

// ── preview_queue_slots ──

describe('preview_queue_slots', () => {
  beforeEach(() => vi.clearAllMocks());

  it('previews upcoming queue slots', async () => {
    const sdk = mockSdk();
    sdk.queue.previewQueue.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([
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
    const sdk = mockSdk();
    sdk.queue.previewQueue.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([{ datetime: '2025-06-16T09:00:00Z' }]);

    const handler = getToolHandler('preview_queue_slots');
    await handler({ profileId: 'prof1', count: 5 });

    expect(sdk.queue.previewQueue).toHaveBeenCalledWith({
      query: { profileId: 'prof1', count: 5 },
    });
  });

  it('passes queueId when specified', async () => {
    const sdk = mockSdk();
    sdk.queue.previewQueue.mockResolvedValue({ data: [] });
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('preview_queue_slots');
    await handler({ profileId: 'prof1', queueId: 'q2', count: 3 });

    expect(sdk.queue.previewQueue).toHaveBeenCalledWith({
      query: { profileId: 'prof1', count: 3, queueId: 'q2' },
    });
  });

  it('returns empty message when no slots found', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No upcoming queue slots');
  });

  it('numbers the slots sequentially', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { datetime: '2025-06-16T09:00:00Z' },
      { datetime: '2025-06-16T12:00:00Z' },
    ]);

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.content[0].text).toContain(' 1.');
    expect(result.content[0].text).toContain(' 2.');
  });

  it('returns error on SDK failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => {
      throw new Error('Service unavailable');
    });

    const handler = getToolHandler('preview_queue_slots');
    const result = await handler({ profileId: 'prof1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Service unavailable');
  });
});
