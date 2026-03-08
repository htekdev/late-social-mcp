import { server } from '../mcpServer.js';
import { getClient, unwrap, toDisplayPlatform } from '../client/lateClient.js';
import { textResponse, errorResponse } from '../types/tools.js';
import { z } from 'zod';

server.tool(
  'list_accounts',
  'List connected social media accounts with platform, display name, username, and active status',
  { platform: z.string().optional(), profileId: z.string().optional() },
  async ({ platform, profileId }) => {
    try {
      const late = getClient().sdk;
      const query: Record<string, string> = {};
      if (platform) query.platform = platform;
      if (profileId) query.profileId = profileId;

      const data = unwrap(await late.accounts.listAccounts({ query }));
      const accounts = Array.isArray(data) ? data : [];

      if (accounts.length === 0) {
        return textResponse('No connected accounts found.');
      }

      const lines = accounts.map((a: Record<string, unknown>, i: number) => {
        const plat = toDisplayPlatform(String(a.platform ?? ''));
        const display = a.displayName ?? 'N/A';
        const user = a.username ?? 'N/A';
        const active = a.isActive ? '✅ Active' : '❌ Inactive';
        return `${i + 1}. [${plat}] ${display} (@${user}) — ${active}`;
      });

      return textResponse(`Connected Accounts (${accounts.length}):\n${lines.join('\n')}`);
    } catch (err: unknown) {
      return errorResponse(`Failed to list accounts: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'check_account_health',
  'Check health status for a specific account or all accounts — shows token status, permissions, and recommendations',
  { accountId: z.string().optional() },
  async ({ accountId }) => {
    try {
      const late = getClient().sdk;

      if (accountId) {
        const data = unwrap(await late.accounts.getAccountHealth({ path: { accountId } }));
        const health = data as Record<string, unknown>;
        const lines = [
          `Account Health: ${accountId}`,
          `Token Status: ${health.tokenStatus ?? 'unknown'}`,
          `Permissions: ${Array.isArray(health.permissions) ? health.permissions.join(', ') : String(health.permissions ?? 'N/A')}`,
        ];
        if (Array.isArray(health.recommendations) && health.recommendations.length > 0) {
          lines.push('Recommendations:');
          for (const rec of health.recommendations) {
            lines.push(`  • ${rec}`);
          }
        }
        return textResponse(lines.join('\n'));
      }

      const data = unwrap(await late.accounts.getAllAccountsHealth({}));
      const healthList = Array.isArray(data) ? data : [];

      if (healthList.length === 0) {
        return textResponse('No account health data available.');
      }

      const sections = healthList.map((h: Record<string, unknown>, i: number) => {
        const plat = toDisplayPlatform(String(h.platform ?? ''));
        const section = [
          `${i + 1}. [${plat}] ${h.displayName ?? h.accountId ?? 'Unknown'}`,
          `   Token: ${h.tokenStatus ?? 'unknown'}`,
          `   Permissions: ${Array.isArray(h.permissions) ? h.permissions.join(', ') : String(h.permissions ?? 'N/A')}`,
        ];
        if (Array.isArray(h.recommendations) && h.recommendations.length > 0) {
          section.push(`   Recommendations: ${h.recommendations.join('; ')}`);
        }
        return section.join('\n');
      });

      return textResponse(`All Accounts Health:\n${sections.join('\n\n')}`);
    } catch (err: unknown) {
      return errorResponse(`Failed to check account health: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'list_profiles',
  'List all profiles with their id, name, color, and description',
  {},
  async () => {
    try {
      const late = getClient().sdk;
      const data = unwrap(await late.profiles.listProfiles());
      const profiles = Array.isArray(data) ? data : [];

      if (profiles.length === 0) {
        return textResponse('No profiles found.');
      }

      const lines = profiles.map((p: Record<string, unknown>, i: number) =>
        `${i + 1}. ${p.name ?? 'Unnamed'} (${p.id})\n   Color: ${p.color ?? 'N/A'}\n   Description: ${p.description ?? 'N/A'}`,
      );

      return textResponse(`Profiles (${profiles.length}):\n${lines.join('\n\n')}`);
    } catch (err: unknown) {
      return errorResponse(`Failed to list profiles: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'get_usage_stats',
  'Show current plan usage — plan name, billing period, limits, and usage counts',
  {},
  async () => {
    try {
      const late = getClient().sdk;
      const data = unwrap(await late.usage.getUsageStats());
      const usage = data as Record<string, unknown>;

      const lines = [
        `Plan: ${usage.planName ?? usage.plan ?? 'N/A'}`,
        `Billing Period: ${usage.billingPeriodStart ?? 'N/A'} — ${usage.billingPeriodEnd ?? 'N/A'}`,
      ];

      if (usage.limits && typeof usage.limits === 'object') {
        const limits = usage.limits as Record<string, unknown>;
        lines.push('Limits:');
        for (const [key, value] of Object.entries(limits)) {
          lines.push(`  ${key}: ${value}`);
        }
      }

      if (usage.usage && typeof usage.usage === 'object') {
        const counts = usage.usage as Record<string, unknown>;
        lines.push('Current Usage:');
        for (const [key, value] of Object.entries(counts)) {
          lines.push(`  ${key}: ${value}`);
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to get usage stats: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);
