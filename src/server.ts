import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export const server = new McpServer(
  {
    name: 'late-social-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Side-effect imports register tools on the shared `server` instance
import './tools/setup.js';
import './tools/posts.js';
import './tools/scheduling.js';
import './tools/queue.js';
import './tools/analytics.js';
import './tools/engagement/messages.js';
import './tools/engagement/comments.js';
import './tools/engagement/reviews.js';
import './tools/accounts.js';
import './tools/media.js';
import './tools/validate.js';
import './tools/webhooks.js';
import './tools/logs.js';

// Smart tools use explicit registration functions
import { registerRealignTools } from './tools/smart/realign.js';
import { registerRescheduleTools } from './tools/smart/reschedule.js';
import { registerOptimizeTools } from './tools/smart/optimize.js';

registerRealignTools();
registerRescheduleTools();
registerOptimizeTools();

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
