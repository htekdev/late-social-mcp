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
}));

import { server } from '../../src/mcpServer.js';
import { getClient, unwrap } from '../../src/client/lateClient.js';

await import('../../src/tools/engagement/messages.js');

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

// Capture handlers at import time before clearAllMocks can wipe them
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
    messages: {
      listInboxConversations: vi.fn().mockResolvedValue({ data: [] }),
      getInboxConversation: vi.fn().mockResolvedValue({ data: null }),
      getInboxConversationMessages: vi.fn().mockResolvedValue({ data: [] }),
      sendInboxMessage: vi.fn().mockResolvedValue({ data: {} }),
      editInboxMessage: vi.fn().mockResolvedValue({ data: {} }),
    },
    ...overrides,
  };
  vi.mocked(getClient).mockReturnValue({ sdk } as unknown as ReturnType<typeof getClient>);
  return sdk;
}

describe('messages tools registration', () => {
  it('registers all five message tools', () => {
    const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
    expect(names).toContain('list_conversations');
    expect(names).toContain('get_conversation');
    expect(names).toContain('list_messages');
    expect(names).toContain('send_message');
    expect(names).toContain('edit_message');
  });
});

describe('list_conversations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted conversation list', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { id: 'c1', platform: 'instagram', participantName: 'Alice', lastMessage: 'Hey there!', unreadCount: 2 },
    ]);

    const handler = getToolHandler('list_conversations');
    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Inbox Conversations');
    expect(result.content[0].text).toContain('c1');
    expect(result.content[0].text).toContain('Alice');
    expect(result.content[0].text).toContain('Hey there!');
  });

  it('returns empty message when no conversations', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([]);

    const handler = getToolHandler('list_conversations');
    const result = await handler({});

    expect(result.content[0].text).toContain('No conversations found');
  });

  it('returns error on failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Unauthorized'); });

    const handler = getToolHandler('list_conversations');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('get_conversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conversation details', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({
      id: 'c1', platform: 'twitter', participantName: 'Bob', unreadCount: 0, lastMessage: 'Thanks!',
    });

    const handler = getToolHandler('get_conversation');
    const result = await handler({ conversationId: 'c1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Conversation Details');
    expect(result.content[0].text).toContain('Bob');
  });

  it('returns empty when conversation not found', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue(null);

    const handler = getToolHandler('get_conversation');
    const result = await handler({ conversationId: 'none', accountId: 'a1' });

    expect(result.content[0].text).toContain('No conversation found');
  });
});

describe('list_messages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted message list', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue([
      { id: 'm1', senderName: 'Alice', message: 'Hello!', sentAt: '2024-06-01T10:00:00Z', isOutgoing: false },
      { id: 'm2', senderName: 'Me', message: 'Hi Alice!', sentAt: '2024-06-01T10:05:00Z', isOutgoing: true },
    ]);

    const handler = getToolHandler('list_messages');
    const result = await handler({ conversationId: 'c1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Messages');
    expect(result.content[0].text).toContain('Alice');
    expect(result.content[0].text).toContain('(received)');
    expect(result.content[0].text).toContain('(sent)');
    expect(result.content[0].text).toContain('Total messages: 2');
  });
});

describe('send_message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a message and confirms', async () => {
    const sdk = mockSdk();
    sdk.messages.sendInboxMessage.mockResolvedValue({ data: { id: 'new-m1', sentAt: '2024-06-01T12:00:00Z' } });
    vi.mocked(unwrap).mockReturnValue({ id: 'new-m1', sentAt: '2024-06-01T12:00:00Z' });

    const handler = getToolHandler('send_message');
    const result = await handler({ conversationId: 'c1', accountId: 'a1', message: 'Hello!' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Message Sent');
    expect(result.content[0].text).toContain('c1');
    expect(result.content[0].text).toContain('Hello!');
    expect(result.content[0].text).toContain('new-m1');
  });

  it('returns error on send failure', async () => {
    mockSdk();
    vi.mocked(unwrap).mockImplementation(() => { throw new Error('Rate limited'); });

    const handler = getToolHandler('send_message');
    const result = await handler({ conversationId: 'c1', accountId: 'a1', message: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rate limited');
  });
});

describe('edit_message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edits a message and confirms', async () => {
    mockSdk();
    vi.mocked(unwrap).mockReturnValue({});

    const handler = getToolHandler('edit_message');
    const result = await handler({ conversationId: 'c1', messageId: 'm1', message: 'Updated text' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Message Edited');
    expect(result.content[0].text).toContain('m1');
    expect(result.content[0].text).toContain('Updated text');
  });
});
