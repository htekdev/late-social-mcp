import { server } from '../../mcpServer.js';
import { getClient, toApiPlatform } from '../../client/lateClient.js';
import { textResponse, errorResponse } from '../../types/tools.js';
import { z } from 'zod';

// ── list_conversations ──────────────────────────────────────────────────────

server.tool(
  'list_conversations',
  'List inbox conversations — DMs and direct messages across platforms',
  {
    profileId: z.string().optional().describe('Filter by profile ID'),
    platform: z.string().optional().describe('Filter by platform (e.g. instagram, twitter)'),
    limit: z.number().optional().describe('Max results to return'),
    page: z.number().optional().describe('Page number for pagination'),
  },
  async ({ profileId, platform, limit, page }) => {
    try {
      const client = getClient();
      const items = await client.listConversations({
        profileId,
        platform: platform ? toApiPlatform(platform) : undefined,
        limit,
        page,
      });

      if (!items || items.length === 0) {
        return textResponse('No conversations found.');
      }
      const lines: string[] = ['💬 Inbox Conversations', '═'.repeat(60)];

      for (const item of items) {
        const c = item as Record<string, unknown>;
        lines.push('');
        if (c.id) lines.push(`Conversation ID: ${c.id}`);
        if (c.platform) lines.push(`Platform:        ${c.platform}`);
        if (c.participantName || c.participant) lines.push(`Participant:     ${c.participantName ?? c.participant}`);
        if (c.lastMessage) lines.push(`Last Message:    ${truncate(String(c.lastMessage), 80)}`);
        if (c.lastMessageAt || c.updatedAt) lines.push(`Last Activity:   ${c.lastMessageAt ?? c.updatedAt}`);
        if (c.unreadCount !== undefined) lines.push(`Unread:          ${c.unreadCount}`);
        lines.push('─'.repeat(60));
      }

      lines.push(`\nTotal conversations: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to list conversations: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── get_conversation ────────────────────────────────────────────────────────

server.tool(
  'get_conversation',
  'Get details of a specific inbox conversation',
  {
    conversationId: z.string().describe('The conversation ID'),
    accountId: z.string().describe('The account ID associated with the conversation'),
  },
  async ({ conversationId, accountId }) => {
    try {
      const client = getClient();
      const data = await client.getConversation(conversationId, accountId);

      if (!data) {
        return textResponse(`No conversation found with ID ${conversationId}.`);
      }

      const c = data as Record<string, unknown>;
      const lines: string[] = ['💬 Conversation Details', '═'.repeat(55)];
      if (c.id) lines.push(`Conversation ID: ${c.id}`);
      if (c.platform) lines.push(`Platform:        ${c.platform}`);
      if (c.participantName || c.participant) lines.push(`Participant:     ${c.participantName ?? c.participant}`);
      if (c.participantUsername) lines.push(`Username:        ${c.participantUsername}`);
      if (c.accountId) lines.push(`Account ID:      ${c.accountId}`);
      if (c.lastMessage) lines.push(`Last Message:    ${truncate(String(c.lastMessage), 80)}`);
      if (c.lastMessageAt || c.updatedAt) lines.push(`Last Activity:   ${c.lastMessageAt ?? c.updatedAt}`);
      if (c.unreadCount !== undefined) lines.push(`Unread:          ${c.unreadCount}`);
      if (c.createdAt) lines.push(`Created:         ${c.createdAt}`);

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to get conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── list_messages ───────────────────────────────────────────────────────────

server.tool(
  'list_messages',
  'List messages in a specific inbox conversation',
  {
    conversationId: z.string().describe('The conversation ID'),
    accountId: z.string().describe('The account ID'),
    limit: z.number().optional().describe('Max messages to return'),
    page: z.number().optional().describe('Page number for pagination'),
  },
  async ({ conversationId, accountId, limit, page }) => {
    try {
      const client = getClient();
      const items = await client.listMessages(conversationId, accountId, { limit, page });

      if (!items || items.length === 0) {
        return textResponse(`No messages found in conversation ${conversationId}.`);
      }
      const lines: string[] = [
        `📨 Messages — Conversation ${conversationId}`,
        '═'.repeat(60),
      ];

      for (const item of items) {
        const m = item as Record<string, unknown>;
        const sender = m.senderName ?? m.sender ?? m.from ?? 'Unknown';
        const timestamp = m.sentAt ?? m.createdAt ?? m.timestamp ?? '';
        const direction = m.isOutgoing ? '→ (sent)' : '← (received)';

        lines.push('');
        lines.push(`[${timestamp}] ${sender} ${direction}`);
        if (m.message ?? m.text ?? m.content) {
          lines.push(`  ${m.message ?? m.text ?? m.content}`);
        }
        if (m.id) lines.push(`  Message ID: ${m.id}`);
        lines.push('─'.repeat(60));
      }

      lines.push(`\nTotal messages: ${items.length}`);
      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to list messages: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── send_message ────────────────────────────────────────────────────────────

server.tool(
  'send_message',
  'Send a message in an inbox conversation',
  {
    conversationId: z.string().describe('The conversation ID to send message in'),
    accountId: z.string().describe('The account ID to send from'),
    message: z.string().describe('The message text to send'),
  },
  async ({ conversationId, accountId, message }) => {
    try {
      const client = getClient();
      const result = await client.sendMessage(conversationId, accountId, message) as Record<string, unknown> | undefined;
      const lines: string[] = [
        '✅ Message Sent',
        '═'.repeat(40),
        `Conversation: ${conversationId}`,
        `Account:      ${accountId}`,
        `Message:      ${truncate(message, 100)}`,
      ];

      if (result?.id) lines.push(`Message ID:   ${result.id}`);
      if (result?.sentAt) lines.push(`Sent at:      ${result.sentAt}`);

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── edit_message ────────────────────────────────────────────────────────────

server.tool(
  'edit_message',
  'Edit a previously sent inbox message',
  {
    conversationId: z.string().describe('The conversation ID'),
    messageId: z.string().describe('The message ID to edit'),
    message: z.string().describe('The updated message text'),
  },
  async ({ conversationId, messageId, message }) => {
    try {
      const client = getClient();
      await client.editMessage(conversationId, messageId, message);

      const lines: string[] = [
        '✏️  Message Edited',
        '═'.repeat(40),
        `Conversation: ${conversationId}`,
        `Message ID:   ${messageId}`,
        `New Text:     ${truncate(message, 100)}`,
      ];

      return textResponse(lines.join('\n'));
    } catch (err) {
      return errorResponse(`Failed to edit message: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}
