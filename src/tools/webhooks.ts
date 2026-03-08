import { server } from '../mcpServer.js';
import { getClient, unwrap } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

server.tool(
  'list_webhooks',
  'List all configured webhook endpoints with their events and status',
  {},
  async () => {
    try {
      const late = getClient().sdk;
      const data = unwrap(await late.webhooks.getWebhookSettings());
      const webhooks = Array.isArray(data) ? data : [];

      if (webhooks.length === 0) {
        return textResponse('No webhooks configured.');
      }

      const lines = webhooks.map((w: Record<string, unknown>, i: number) => {
        const active = w.isActive ? '✅ Active' : '❌ Inactive';
        const events = Array.isArray(w.events) ? w.events.join(', ') : String(w.events ?? 'N/A');
        return [
          `${i + 1}. ${w.name ?? 'Unnamed'} (${w._id ?? w.id ?? 'N/A'})`,
          `   URL: ${w.url ?? 'N/A'}`,
          `   Events: ${events}`,
          `   Status: ${active}`,
        ].join('\n');
      });

      return textResponse(`Webhooks (${webhooks.length}):\n${lines.join('\n\n')}`);
    } catch (err: unknown) {
      return errorResponse(`Failed to list webhooks: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'create_webhook',
  'Create a new webhook endpoint that receives event notifications',
  {
    url: z.string(),
    events: z.string().describe('Comma-separated event names'),
    name: z.string().optional(),
  },
  async ({ url, events, name }) => {
    try {
      const late = getClient().sdk;
      const eventList = events.split(',').map((e) => e.trim()).filter(Boolean);
      const body: Record<string, unknown> = { url, events: eventList };
      if (name) body.name = name;

      const data = unwrap(await late.webhooks.createWebhookSettings({ body }));
      const webhook = data as Record<string, unknown>;

      const lines = [
        '✅ Webhook created successfully!',
        `ID: ${webhook._id ?? webhook.id ?? 'N/A'}`,
        `Name: ${webhook.name ?? name ?? 'N/A'}`,
        `URL: ${url}`,
        `Events: ${eventList.join(', ')}`,
      ];

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to create webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'update_webhook',
  'Update an existing webhook — change URL, events, name, or active status',
  {
    webhookId: z.string(),
    url: z.string().optional(),
    events: z.string().optional().describe('Comma-separated event names'),
    name: z.string().optional(),
    isActive: z.boolean().optional(),
  },
  async ({ webhookId, url, events, name, isActive }) => {
    try {
      const late = getClient().sdk;
      const body: Record<string, unknown> = { _id: webhookId };
      if (url !== undefined) body.url = url;
      if (name !== undefined) body.name = name;
      if (isActive !== undefined) body.isActive = isActive;
      if (events !== undefined) {
        body.events = events.split(',').map((e) => e.trim()).filter(Boolean);
      }

      const data = unwrap(await late.webhooks.updateWebhookSettings({ body }));
      const webhook = data as Record<string, unknown>;

      const lines = [
        '✅ Webhook updated successfully!',
        `ID: ${webhookId}`,
        `Name: ${webhook.name ?? name ?? 'N/A'}`,
        `URL: ${webhook.url ?? url ?? 'N/A'}`,
        `Active: ${webhook.isActive ?? isActive ?? 'N/A'}`,
      ];

      if (webhook.events || events) {
        const eventList = Array.isArray(webhook.events) ? webhook.events : events?.split(',').map((e) => e.trim());
        lines.push(`Events: ${eventList?.join(', ') ?? 'N/A'}`);
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to update webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'test_webhook',
  'Send a test event to a webhook endpoint to verify it is receiving events',
  { webhookId: z.string() },
  async ({ webhookId }) => {
    try {
      const late = getClient().sdk;
      const data = unwrap(await late.webhooks.testWebhook({ body: { webhookId } }));
      const result = data as Record<string, unknown>;

      const success = result.success !== false;
      const lines = [
        success ? '✅ Webhook test sent successfully!' : '❌ Webhook test failed.',
        `Webhook ID: ${webhookId}`,
      ];

      if (result.statusCode) lines.push(`Response Status: ${result.statusCode}`);
      if (result.message) lines.push(`Message: ${result.message}`);
      if (result.error) lines.push(`Error: ${result.error}`);

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to test webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);
