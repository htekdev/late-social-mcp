import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const server = new McpServer(
  {
    name: 'late-social-mcp',
    version: '0.1.1',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);
