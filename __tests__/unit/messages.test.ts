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

mockClient = createMockClient();

import { server } from '../../src/mcpServer.js';

await import('../../src/tools/engagement/messages.js');

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

// Capture handlers at import time before createMockClient resets them
const toolHandlers = new Map<string, ToolHandler>();
for (const call of vi.mocked(server.tool).mock.calls) {
  toolHandlers.set(call[0] as string, call[call.length - 1] as ToolHandler);
}

function getToolHandler(toolName: string): ToolHandler {
  const handler = toolHandlers.get(toolName);
  if (!handler) throw new Error(`Tool "${toolName}" not registered`);
  return handler;
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
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns formatted conversation list', async () => {
    mockClient.listConversations.mockResolvedValue([
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
    mockClient.listConversations.mockResolvedValue([]);

    const handler = getToolHandler('list_conversations');
    const result = await handler({});

    expect(result.content[0].text).toContain('No conversations found');
  });

  it('returns error on failure', async () => {
    mockClient.listConversations.mockRejectedValue(new Error('Unauthorized'));

    const handler = getToolHandler('list_conversations');
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('get_conversation', () => {
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns conversation details', async () => {
    mockClient.getConversation.mockResolvedValue({
      id: 'c1', platform: 'twitter', participantName: 'Bob', unreadCount: 0, lastMessage: 'Thanks!',
    });

    const handler = getToolHandler('get_conversation');
    const result = await handler({ conversationId: 'c1', accountId: 'a1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Conversation Details');
    expect(result.content[0].text).toContain('Bob');
  });

  it('returns empty when conversation not found', async () => {
    mockClient.getConversation.mockResolvedValue(null);

    const handler = getToolHandler('get_conversation');
    const result = await handler({ conversationId: 'none', accountId: 'a1' });

    expect(result.content[0].text).toContain('No conversation found');
  });
});

describe('list_messages', () => {
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns formatted message list', async () => {
    mockClient.listMessages.mockResolvedValue([
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
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('sends a message and confirms', async () => {
    mockClient.sendMessage.mockResolvedValue({ id: 'new-m1', sentAt: '2024-06-01T12:00:00Z' });

    const handler = getToolHandler('send_message');
    const result = await handler({ conversationId: 'c1', accountId: 'a1', message: 'Hello!' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Message Sent');
    expect(result.content[0].text).toContain('c1');
    expect(result.content[0].text).toContain('Hello!');
    expect(result.content[0].text).toContain('new-m1');
  });

  it('returns error on send failure', async () => {
    mockClient.sendMessage.mockRejectedValue(new Error('Rate limited'));

    const handler = getToolHandler('send_message');
    const result = await handler({ conversationId: 'c1', accountId: 'a1', message: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rate limited');
  });
});

describe('edit_message', () => {
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('edits a message and confirms', async () => {
    mockClient.editMessage.mockResolvedValue(undefined);

    const handler = getToolHandler('edit_message');
    const result = await handler({ conversationId: 'c1', messageId: 'm1', message: 'Updated text' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Message Edited');
    expect(result.content[0].text).toContain('m1');
    expect(result.content[0].text).toContain('Updated text');
  });
});
