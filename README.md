# late-social-mcp

**Comprehensive social media management MCP server via Late API**

[![npm version](https://img.shields.io/npm/v/late-social-mcp.svg)](https://www.npmjs.com/package/late-social-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## What is this?

late-social-mcp is a standalone [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for managing social media through the [Late API](https://getlate.dev). It is **not** a Copilot extension or plugin — it's a general-purpose MCP server that works with any MCP-compatible client:

- **GitHub Copilot CLI / VS Code**
- **Claude Desktop**
- **Cursor**
- Any other MCP client

It exposes **47 MCP tools** across **13 categories** — covering posts, scheduling, smart realignment, analytics, engagement (messages, comments, reviews), media, webhooks, and more.

## Quick Start

### Install

```bash
npm install -g late-social-mcp
```

### Set your API key

```bash
export LATE_API_KEY=your_api_key_here
```

Get your API key from [getlate.dev](https://getlate.dev).

## MCP Client Configuration

### Copilot CLI / VS Code

Add to your `.mcp.json`:

```json
{
  "servers": {
    "late-social-mcp": {
      "command": "npx",
      "args": ["-y", "late-social-mcp"]
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "late-social-mcp": {
      "command": "npx",
      "args": ["-y", "late-social-mcp"],
      "env": {
        "LATE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tool Reference

47 tools organized into 13 categories:

| # | Category | Tools | Tool Names |
|---|----------|-------|------------|
| 1 | **Setup & Config** | 3 | `setup_late`, `late_status`, `import_schedule_config` |
| 2 | **Posts** | 8 | `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`, `retry_post`, `unpublish_post`, `bulk_upload_posts` |
| 3 | **Scheduling** | 4 | `schedule_post`, `find_next_slot`, `view_calendar`, `view_schedule_config` |
| 4 | **Smart Features** | 7 | `realign_schedule`, `prioritized_realign`, `check_realign_status`, `smart_reschedule`, `get_best_times`, `get_posting_frequency`, `get_content_decay` |
| 5 | **Queue** | 5 | `list_queues`, `create_queue`, `update_queue`, `delete_queue`, `preview_queue_slots` |
| 6 | **Analytics** | 5 | `get_post_analytics`, `get_daily_metrics`, `get_follower_stats`, `get_post_timeline`, `get_youtube_daily_views` |
| 7 | **Messages** | 5 | `list_conversations`, `get_conversation`, `list_messages`, `send_message`, `edit_message` |
| 8 | **Comments** | 7 | `list_commented_posts`, `get_post_comments`, `reply_to_comment`, `delete_comment`, `hide_comment`, `like_comment`, `send_private_reply` |
| 9 | **Reviews** | 3 | `list_reviews`, `reply_to_review`, `delete_review_reply` |
| 10 | **Accounts** | 4 | `list_accounts`, `check_account_health`, `list_profiles`, `get_usage_stats` |
| 11 | **Media & Validation** | 5 | `upload_media`, `validate_media`, `validate_post`, `validate_post_length`, `check_instagram_hashtags` |
| 12 | **Webhooks** | 4 | `list_webhooks`, `create_webhook`, `update_webhook`, `test_webhook` |
| 13 | **Logs** | 3 | `get_post_logs`, `list_publishing_logs`, `list_connection_logs` |

## Schedule Config

Create a `schedule.json` in your working directory to define your posting schedule. The server uses this for slot-based scheduling, realignment, and conflict detection.

```json
{
  "timezone": "America/Chicago",
  "platforms": {
    "x": {
      "slots": [
        { "days": ["mon", "wed", "fri"], "time": "09:00", "label": "Morning post" },
        { "days": ["tue", "thu"], "time": "14:00", "label": "Afternoon post" }
      ],
      "avoidDays": ["sat", "sun"],
      "byClipType": {
        "short": {
          "slots": [{ "days": ["mon", "tue", "wed", "thu", "fri"], "time": "12:00", "label": "Noon short" }],
          "avoidDays": []
        }
      }
    }
  }
}
```

**Fields:**

- **`timezone`** — IANA timezone for all slot times (e.g. `America/Chicago`, `UTC`)
- **`platforms`** — Per-platform schedule configuration, keyed by platform name (`x`, `instagram`, `youtube`, etc.)
  - **`slots`** — Array of time slots with `days` (day abbreviations), `time` (HH:MM 24h), and optional `label`
  - **`avoidDays`** — Days to skip when scheduling (e.g. weekends)
  - **`byClipType`** — Override slots for specific content types (e.g. `short`, `reel`)

Import an existing config into the server with `import_schedule_config`, or view the active config with `view_schedule_config`.

## Smart Features

### Realignment

`realign_schedule` compacts your posting schedule by filling gaps left by deleted or failed posts. It shifts pending posts forward to maintain a consistent cadence without changing their relative order.

### Prioritized Realignment

`prioritized_realign` extends realignment with keyword-based priority scoring and saturation probability. Posts matching priority keywords are scheduled into prime slots first. Saturation probability controls how aggressively lower-priority posts fill remaining slots.

### Smart Rescheduling

`smart_reschedule` detects scheduling conflicts (multiple posts in the same slot, overlapping windows) and automatically resolves them by redistributing posts to nearby available slots.

### Best Times

`get_best_times` analyzes your historical engagement data to recommend optimal posting times per platform.

### Posting Frequency

`get_posting_frequency` determines the ideal posting cadence for each platform based on engagement trends and audience behavior.

### Content Decay

`get_content_decay` measures how quickly engagement drops off after publishing, helping you understand the effective lifespan of your content per platform.

## Configuration

| Config | Source | Description |
|--------|--------|-------------|
| `LATE_API_KEY` | Environment variable | **Required.** Your Late API key |
| `./late-social-mcp.config.json` | Auto-generated file | Persistent server config (account selections, preferences) |
| `./schedule.json` | User-created file | Schedule configuration (optional) |

All configuration files are **CWD-relative** — the server reads and writes config in whichever directory you run it from.

## Development

```bash
git clone https://github.com/htekdev/late-social-mcp.git
cd late-social-mcp
npm install
npm run build
npm test
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Bundle with esbuild to `bin/mcp-server.cjs` |
| `npm test` | Run tests with vitest |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check with TypeScript (no emit) |

### Project Structure

```
src/
├── server.ts           # MCP server entry point
├── client/             # Late API client wrapper
├── config/             # Configuration management
├── types/              # Shared TypeScript types
├── smart/              # Smart feature logic (realignment, scheduling, optimization)
│   ├── realignment.ts
│   ├── prioritizedRealignment.ts
│   ├── scheduler.ts
│   └── optimizer.ts
└── tools/              # MCP tool definitions
    ├── setup.ts
    ├── posts.ts
    ├── scheduling.ts
    ├── queue.ts
    ├── analytics.ts
    ├── media.ts
    ├── validate.ts
    ├── accounts.ts
    ├── webhooks.ts
    ├── logs.ts
    ├── smart/          # Smart feature tool wrappers
    │   ├── realign.ts
    │   ├── reschedule.ts
    │   └── optimize.ts
    └── engagement/     # Engagement tool wrappers
        ├── messages.ts
        ├── comments.ts
        └── reviews.ts
```

## License

[MIT](LICENSE) © Hector Flores
