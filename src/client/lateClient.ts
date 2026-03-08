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

// Unwrap SDK response - throws on error
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error) {
    const errMsg = typeof result.error === 'object' && result.error !== null && 'error' in result.error
      ? String((result.error as Record<string, unknown>).error)
      : JSON.stringify(result.error);
    throw new Error(`Late API error: ${errMsg}`);
  }
  return result.data as T;
}

let clientInstance: LateClient | null = null;

export function getClient(): LateClient {
  if (!clientInstance) {
    clientInstance = new LateClient();
  }
  return clientInstance;
}
