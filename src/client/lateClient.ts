import { Late } from '@getlatedev/node';
import { getLateApiKey } from '../config/config.js';

export class LateClient {
  private client: Late | null = null;

  ensureClient(): Late {
    if (this.client) return this.client;
    const apiKey = getLateApiKey();
    if (!apiKey) {
      throw new Error('Late API key not configured. Set LATE_API_KEY environment variable.');
    }
    this.client = new Late({ apiKey });
    return this.client;
  }

  // Reset client (useful when API key changes)
  reset(): void {
    this.client = null;
  }

  get sdk(): Late {
    return this.ensureClient();
  }
}

// Normalize platform names for Late API (API uses 'twitter', schedule config uses 'x')
const API_PLATFORM_MAP: Record<string, string> = { x: 'twitter' };
const DISPLAY_PLATFORM_MAP: Record<string, string> = { twitter: 'x' };

export function toApiPlatform(platform: string): string {
  return API_PLATFORM_MAP[platform.toLowerCase()] ?? platform.toLowerCase();
}

export function toDisplayPlatform(platform: string): string {
  return DISPLAY_PLATFORM_MAP[platform.toLowerCase()] ?? platform.toLowerCase();
}

// Unwrap SDK response - throws on error, extracts nested data
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    const errMsg = typeof result.error === 'object' && result.error !== null && 'error' in result.error
      ? String((result.error as Record<string, unknown>).error)
      : JSON.stringify(result.error);
    throw new Error(`Late API error: ${errMsg}`);
  }
  const data = result.data as T;
  // Late SDK wraps list responses in { posts: [...] }, { accounts: [...] }, etc.
  // Auto-extract the nested array if the response is a single-key object with an array value.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 1) {
      const val = (data as Record<string, unknown>)[keys[0]];
      if (Array.isArray(val)) return val as T;
    }
  }
  return data;
}

let clientInstance: LateClient | null = null;

export function getClient(): LateClient {
  if (!clientInstance) {
    clientInstance = new LateClient();
  }
  return clientInstance;
}
