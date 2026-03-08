# Copilot Instructions — late-social-mcp

## Project Overview

This is a standalone MCP (Model Context Protocol) server for managing social media through the Late API. It is **not** a Copilot extension — it's a general-purpose MCP server that works with any MCP client (Copilot CLI, Claude Desktop, Cursor, etc.).

## Tech Stack

- **Runtime**: Node.js ≥ 18, TypeScript with strict mode
- **Module system**: ESM (`"type": "module"` in package.json) — always use `.js` extensions in import paths
- **MCP SDK**: `@modelcontextprotocol/sdk` for server, tool registration, and transport
- **Late API SDK**: `@getlatedev/node` for all Late API interactions
- **Validation**: `zod` for tool input schemas
- **Build**: esbuild → `bin/mcp-server.cjs` (CJS bundle for CLI execution)
- **Testing**: vitest with `@vitest/coverage-v8`, minimum 80% coverage
- **Type-checking**: `tsc --noEmit` (no emit, checking only)

## Architecture

### Server Entry Point

`src/server.ts` — creates the MCP server, registers all tools, and starts the stdio transport.

### Tool Registration

Tools register via **side-effect imports** or **`registerXTools(server)`** functions. Each tool file in `src/tools/` exports a registration function that adds tools to the MCP server.

### Directory Layout

- `src/client/` — Late API client wrapper and initialization
- `src/config/` — Configuration management (CWD-relative files)
- `src/types/` — Shared TypeScript types and interfaces
- `src/smart/` — Smart feature business logic (realignment, scheduling, optimization)
- `src/tools/` — MCP tool definitions (one file per category)
- `src/tools/smart/` — Tool wrappers for smart features (thin layer calling `src/smart/`)
- `src/tools/engagement/` — Engagement tools (messages, comments, reviews)
- `__tests__/` — Integration tests

## Coding Conventions

### Tool Responses

Always use `textResponse()` for successful tool results and `errorResponse()` for errors. These helpers produce properly formatted MCP `CallToolResult` objects. Never construct raw response objects manually.

### Configuration

All config files are **CWD-relative** — never write to the user's home directory or any global location.

- `./late-social-mcp.config.json` — auto-generated persistent config
- `./schedule.json` — user-provided schedule configuration

### Platform Normalization

The Late API uses `'twitter'` as the platform identifier, but the user-facing config and tool interfaces use `'x'`. Always normalize between these when crossing the boundary between config/tools and API calls.

### Schedule Config Schema

```typescript
interface ScheduleConfig {
  timezone: string; // IANA timezone
  platforms: Record<string, PlatformSchedule>;
}

interface PlatformSchedule {
  slots: Slot[];
  avoidDays: string[];
  byClipType?: Record<string, { slots: Slot[]; avoidDays: string[] }>;
}

interface Slot {
  days: string[];  // "mon", "tue", "wed", "thu", "fri", "sat", "sun"
  time: string;    // "HH:MM" 24-hour format
  label?: string;
}
```

### Import Style

Always use `.js` extensions in TypeScript imports (ESM requirement):

```typescript
import { textResponse } from '../config/responses.js';
import { realignSchedule } from '../smart/realignment.js';
```

### Error Handling

Never swallow errors silently. All tool handlers must catch errors and return `errorResponse()` with a meaningful message. Log to stderr for debugging — never to stdout (stdout is the MCP transport).

### No Placeholders

Never leave `TODO`, `FIXME`, `// needs implementation`, or any stub code. Every function must be fully implemented before commit.

## Testing

### Framework

Tests use **vitest** and live in `__tests__/`. Run with:

```bash
npm test                # run all tests
npm run test:coverage   # run with coverage report
npm run test:watch      # watch mode
```

### Coverage Requirements

Minimum 80% coverage across statements, branches, functions, and lines. Coverage is enforced in CI.

### Test Principles

- Test real behavior, not implementation details
- Mock the Late API client, not internal modules
- Every source change ships with corresponding tests
- No `test.todo()` or `it.skip()` placeholders — write real assertions

## Build

```bash
npm run build
```

Produces `bin/mcp-server.cjs` via esbuild. The output is a single CJS file that runs as a CLI tool. The `bin` field in `package.json` maps `late-social-mcp` to this file.

## Smart Features Architecture

Smart feature logic lives in `src/smart/`, tool wrappers in `src/tools/smart/`. The tool wrappers are thin — they parse MCP input, call the smart logic, and format the response.

- `src/smart/realignment.ts` — schedule compaction and gap-filling
- `src/smart/prioritizedRealignment.ts` — keyword-priority realignment with saturation probability
- `src/smart/scheduler.ts` — conflict detection and auto-resolution
- `src/smart/optimizer.ts` — best times, posting frequency, content decay analysis

## Quality Gates

This project uses **hookflows** (`.github/hookflows/`) for agent governance. Hookflows enforce:

- No placeholder code or TODOs
- Tests accompany source changes
- Coverage thresholds are met
- No secrets in source code
- Protected config files (package.json, tsconfig.json) get extra scrutiny

## Key Reminders

- This is an MCP server, not a web app — it communicates via stdio transport
- 47 tools across 13 categories — keep tool files organized by category
- Smart features separate logic (`src/smart/`) from tool registration (`src/tools/smart/`)
- CWD-relative config, never global paths
- `'x'` in config ↔ `'twitter'` in Late API — always normalize
- Use `textResponse()` / `errorResponse()` — never raw MCP response objects
