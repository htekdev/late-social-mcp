import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { server } from '../mcpServer.js';
import { getClient } from '../client/lateClient.js';
import { getLateApiKey, loadConfig, saveConfig, CONFIG_FILE } from '../config/config.js';
import { validateScheduleConfig } from '../config/scheduleConfig.js';
import { textResponse, errorResponse } from '../types/tools.js';

server.tool(
  'setup_late',
  'Verify LATE_API_KEY env var exists, test connection by listing profiles, and save config',
  {},
  async () => {
    try {
      const apiKey = getLateApiKey();
      if (!apiKey) {
        return errorResponse(
          'LATE_API_KEY environment variable is not set.\n\n' +
            'To configure:\n' +
            '1. Get your API key from https://app.getlate.dev/settings/api\n' +
            '2. Set it as an environment variable: export LATE_API_KEY=your_key_here',
        );
      }

      const client = getClient();
      const { data: profileList } = await client.listProfiles();
      const { data: accountList } = await client.listAccounts();

      const config = loadConfig();
      config.lateApiKey = apiKey;
      saveConfig(config);

      const lines: string[] = [
        '✅ Late API connection successful!',
        '',
        `Config saved to: ${CONFIG_FILE}`,
        `Profiles found: ${profileList.length}`,
        `Connected accounts: ${accountList.length}`,
      ];

      if (accountList.length > 0) {
        lines.push('', 'Accounts:');
        for (const acct of accountList) {
          const active = acct.isActive ? '✓' : '✗';
          lines.push(`  ${active} ${acct.platform} — @${acct.username} (${acct.displayName})`);
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'late_status',
  'Show connection status, list accounts, profiles, and usage stats',
  {},
  async () => {
    try {
      const apiKey = getLateApiKey();
      if (!apiKey) {
        return errorResponse(
          'Not connected. Run setup_late first or set LATE_API_KEY environment variable.',
        );
      }

      const client = getClient();

      const [{ data: profileList }, { data: accountList }, usage] = await Promise.all([
        client.listProfiles(),
        client.listAccounts(),
        client.getUsageStats(),
      ]);

      const lines: string[] = [
        '📊 Late Social MCP Status',
        '═══════════════════════════',
        '',
        '🔑 Connection: Active',
        '',
      ];

      lines.push(`📋 Profiles (${profileList.length}):`);
      if (profileList.length === 0) {
        lines.push('  No profiles found.');
      } else {
        for (const profile of profileList) {
          lines.push(`  • ${profile.name}${profile.description ? ` — ${profile.description}` : ''}`);
        }
      }

      lines.push('');
      lines.push(`🔗 Connected Accounts (${accountList.length}):`);
      if (accountList.length === 0) {
        lines.push('  No accounts connected.');
      } else {
        for (const acct of accountList) {
          const status = acct.isActive ? '🟢' : '🔴';
          lines.push(`  ${status} ${acct.platform} — @${acct.username} (${acct.displayName})`);
        }
      }

      lines.push('');
      lines.push('📈 Usage:');
      if (usage && typeof usage === 'object') {
        for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
          lines.push(`  ${label}: ${value}`);
        }
      } else {
        lines.push('  No usage data available.');
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(`Failed to get status: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.tool(
  'import_schedule_config',
  'Import a schedule configuration from an inline JSON string and save it to ./schedule.json',
  { config: z.string().describe('JSON string containing the schedule configuration') },
  async ({ config: configJson }) => {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(configJson);
      } catch {
        return errorResponse(
          'Invalid JSON. Please provide a valid JSON string.\n\n' +
            'Expected format:\n' +
            '{\n' +
            '  "timezone": "America/New_York",\n' +
            '  "platforms": {\n' +
            '    "twitter": {\n' +
            '      "slots": [{ "days": ["mon","tue"], "time": "09:00", "label": "Morning" }],\n' +
            '      "avoidDays": ["sun"]\n' +
            '    }\n' +
            '  }\n' +
            '}',
        );
      }

      if (!validateScheduleConfig(parsed)) {
        return errorResponse(
          'Invalid schedule config structure. Required fields:\n' +
            '  • timezone (string) — e.g. "America/New_York"\n' +
            '  • platforms (object) — at least one platform with:\n' +
            '    • slots (array) — each with days[], time, label\n' +
            '    • avoidDays (array) — days to skip',
        );
      }

      const schedulePath = path.resolve('schedule.json');
      fs.writeFileSync(schedulePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');

      const platformNames = Object.keys(parsed.platforms);
      const totalSlots = platformNames.reduce((sum, p) => sum + parsed.platforms[p].slots.length, 0);

      const lines: string[] = [
        '✅ Schedule config imported successfully!',
        '',
        `Saved to: ${schedulePath}`,
        `Timezone: ${parsed.timezone}`,
        `Platforms configured: ${platformNames.join(', ')}`,
        `Total time slots: ${totalSlots}`,
      ];

      for (const name of platformNames) {
        const plat = parsed.platforms[name];
        lines.push('');
        lines.push(`  ${name}:`);
        lines.push(`    Slots: ${plat.slots.length}`);
        for (const slot of plat.slots) {
          lines.push(`      • ${slot.label} — ${slot.time} on ${slot.days.join(', ')}`);
        }
        if (plat.avoidDays.length > 0) {
          lines.push(`    Avoid: ${plat.avoidDays.join(', ')}`);
        }
      }

      return textResponse(lines.join('\n'));
    } catch (err: unknown) {
      return errorResponse(
        `Failed to import schedule config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
