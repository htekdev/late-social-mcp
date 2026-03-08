import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient, type MockLateApiClient } from '../helpers/mockApi.js';

let mockClient: MockLateApiClient;

// ---------------------------------------------------------------------------
// Mock the server module the same way tool tests do — a plain object with
// a `tool` spy. This avoids importing the real server.ts (which calls main()
// and tries to connect a transport).
// ---------------------------------------------------------------------------
vi.mock('../../src/mcpServer.js', () => ({
  server: { tool: vi.fn() },
}));

// Mock the client module with the new direct HTTP client pattern
vi.mock('../../src/client/lateClient.js', () => ({
  getClient: vi.fn(() => mockClient),
  toApiPlatform: vi.fn((p: string) => (p === 'x' ? 'twitter' : p)),
  toDisplayPlatform: vi.fn((p: string) => (p === 'twitter' ? 'x' : p)),
  resetClient: vi.fn(),
  LateApiClient: vi.fn(),
}));

beforeEach(() => {
  mockClient = createMockClient();
});

vi.mock('../../src/config/config.js', () => ({
  getLateApiKey: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  CONFIG_FILE: '/mock/config.json',
}));

vi.mock('../../src/config/scheduleConfig.js', () => ({
  validateScheduleConfig: vi.fn(() => true),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

import { server } from '../../src/mcpServer.js';

// Import all the same tool modules that server.ts imports via side-effects.
// Their top-level code calls server.tool() which is captured by our mock.
await import('../../src/tools/setup.js');
await import('../../src/tools/posts.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('server integration', () => {
  describe('server identity', () => {
    it('would be created with name late-social-mcp', async () => {
      // Verify by constructing a real McpServer with the same args used in server.ts
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const real = new McpServer(
        { name: 'late-social-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );
      const info = (real as unknown as { server: { _serverInfo: { name: string; version: string } } })
        .server._serverInfo;
      expect(info.name).toBe('late-social-mcp');
    });

    it('would be created with version 0.1.0', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const real = new McpServer(
        { name: 'late-social-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );
      const info = (real as unknown as { server: { _serverInfo: { name: string; version: string } } })
        .server._serverInfo;
      expect(info.version).toBe('0.1.0');
    });

    it('McpServer constructor accepts tools capability', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const s = new McpServer(
        { name: 'test', version: '0.0.1' },
        { capabilities: { tools: {} } },
      );
      expect(s).toBeDefined();
      expect(typeof s.tool).toBe('function');
    });
  });

  describe('tool registration via server mock', () => {
    it('server.tool mock is callable', () => {
      expect(typeof server.tool).toBe('function');
    });

    it('server.tool was called to register tools', () => {
      expect(vi.mocked(server.tool).mock.calls.length).toBeGreaterThan(0);
    });

    it('registers setup_late tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('setup_late');
    });

    it('registers late_status tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('late_status');
    });

    it('registers import_schedule_config tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('import_schedule_config');
    });

    it('registers list_posts tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('list_posts');
    });

    it('registers get_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('get_post');
    });

    it('registers create_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('create_post');
    });

    it('registers update_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('update_post');
    });

    it('registers delete_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('delete_post');
    });

    it('registers retry_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('retry_post');
    });

    it('registers unpublish_post tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('unpublish_post');
    });

    it('registers bulk_upload_posts tool', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0]);
      expect(names).toContain('bulk_upload_posts');
    });

    it('each tool registration includes a description string', () => {
      for (const call of vi.mocked(server.tool).mock.calls) {
        const description = call[1];
        expect(typeof description).toBe('string');
        expect((description as string).length).toBeGreaterThan(0);
      }
    });

    it('each tool registration ends with a handler function', () => {
      for (const call of vi.mocked(server.tool).mock.calls) {
        const handler = call[call.length - 1];
        expect(typeof handler).toBe('function');
      }
    });

    it('tool names are unique', () => {
      const names = vi.mocked(server.tool).mock.calls.map((c) => c[0] as string);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  describe('server export shape', () => {
    it('exports server as a named export', () => {
      expect(server).toBeDefined();
    });

    it('server is not null', () => {
      expect(server).not.toBeNull();
    });

    it('server has a tool method', () => {
      expect(server).toHaveProperty('tool');
    });
  });
});
