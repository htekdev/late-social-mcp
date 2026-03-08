import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Late SDK before any imports that use it
vi.mock('@getlatedev/node', () => {
  const LateMock = vi.fn(function (this: Record<string, unknown>) {
    this.posts = { list: vi.fn(), create: vi.fn() };
    this.accounts = { list: vi.fn() };
  });
  return { Late: LateMock };
});

// Mock config so getLateApiKey reads from process.env without touching the filesystem
vi.mock('../../src/config/config.js', () => ({
  getLateApiKey: vi.fn(() => process.env.LATE_API_KEY),
}));

describe('lateClient — pure functions', () => {
  // Pure functions can be imported once (no singleton state involved)
  let toApiPlatform: typeof import('../../src/client/lateClient.js').toApiPlatform;
  let toDisplayPlatform: typeof import('../../src/client/lateClient.js').toDisplayPlatform;
  let unwrap: typeof import('../../src/client/lateClient.js').unwrap;

  beforeEach(async () => {
    const mod = await import('../../src/client/lateClient.js');
    toApiPlatform = mod.toApiPlatform;
    toDisplayPlatform = mod.toDisplayPlatform;
    unwrap = mod.unwrap;
  });

  // ── toApiPlatform ─────────────────────────────────────────────────────
  describe('toApiPlatform', () => {
    it('maps "x" to "twitter"', () => {
      expect(toApiPlatform('x')).toBe('twitter');
    });

    it('maps "X" (uppercase) to "twitter"', () => {
      expect(toApiPlatform('X')).toBe('twitter');
    });

    it('passes through "instagram" unchanged', () => {
      expect(toApiPlatform('instagram')).toBe('instagram');
    });

    it('passes through "linkedin" unchanged', () => {
      expect(toApiPlatform('linkedin')).toBe('linkedin');
    });

    it('lowercases unknown platforms', () => {
      expect(toApiPlatform('TikTok')).toBe('tiktok');
    });
  });

  // ── toDisplayPlatform ─────────────────────────────────────────────────
  describe('toDisplayPlatform', () => {
    it('maps "twitter" to "x"', () => {
      expect(toDisplayPlatform('twitter')).toBe('x');
    });

    it('maps "Twitter" (uppercase) to "x"', () => {
      expect(toDisplayPlatform('Twitter')).toBe('x');
    });

    it('passes through "instagram" unchanged', () => {
      expect(toDisplayPlatform('instagram')).toBe('instagram');
    });

    it('passes through "linkedin" unchanged', () => {
      expect(toDisplayPlatform('linkedin')).toBe('linkedin');
    });

    it('lowercases unknown platforms', () => {
      expect(toDisplayPlatform('YouTube')).toBe('youtube');
    });
  });

  // ── unwrap ────────────────────────────────────────────────────────────
  describe('unwrap', () => {
    it('returns data when result has data', () => {
      const result = { data: { id: '123', title: 'hello' } };
      expect(unwrap(result)).toEqual({ id: '123', title: 'hello' });
    });

    it('returns primitive data values', () => {
      expect(unwrap({ data: 42 })).toBe(42);
    });

    it('handles null data (returns null)', () => {
      const result = { data: null };
      expect(unwrap(result)).toBeNull();
    });

    it('handles undefined data (returns undefined)', () => {
      const result = {} as { data?: string; error?: unknown };
      expect(unwrap(result)).toBeUndefined();
    });

    it('throws on string error', () => {
      expect(() => unwrap({ error: 'Something went wrong' })).toThrowError(
        /Late API error/,
      );
    });

    it('throws with the nested error message when error is an object with .error', () => {
      const result = { error: { error: 'rate limit exceeded' } };
      expect(() => unwrap(result)).toThrowError('Late API error: rate limit exceeded');
    });

    it('throws with JSON-stringified error when error is a plain object', () => {
      const result = { error: { code: 500 } };
      expect(() => unwrap(result)).toThrowError(/Late API error/);
    });

    it('prefers error over data when both are present', () => {
      const result = { data: { id: '1' }, error: 'conflict' };
      expect(() => unwrap(result)).toThrowError(/Late API error/);
    });
  });
});

// ── LateClient class & getClient singleton ──────────────────────────────
describe('lateClient — LateClient class & getClient singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LATE_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.LATE_API_KEY;
  });

  it('getClient() returns a LateClient instance', async () => {
    const { getClient, LateClient } = await import('../../src/client/lateClient.js');
    const client = getClient();
    expect(client).toBeInstanceOf(LateClient);
  });

  it('getClient() returns the same instance on subsequent calls (singleton)', async () => {
    const { getClient } = await import('../../src/client/lateClient.js');
    const first = getClient();
    const second = getClient();
    expect(first).toBe(second);
  });

  it('LateClient.sdk returns a Late SDK instance', async () => {
    const { LateClient } = await import('../../src/client/lateClient.js');
    const client = new LateClient();
    const sdk = client.sdk;
    expect(sdk).toBeDefined();
    expect(sdk).toHaveProperty('posts');
    expect(sdk).toHaveProperty('accounts');
  });

  it('LateClient.ensureClient() caches the SDK instance', async () => {
    const { LateClient } = await import('../../src/client/lateClient.js');
    const client = new LateClient();
    const first = client.ensureClient();
    const second = client.ensureClient();
    expect(first).toBe(second);
  });

  it('LateClient.reset() clears the cached client', async () => {
    const { LateClient } = await import('../../src/client/lateClient.js');
    const client = new LateClient();
    const first = client.ensureClient();
    client.reset();
    const second = client.ensureClient();
    expect(first).not.toBe(second);
  });

  it('LateClient throws when LATE_API_KEY is not set', async () => {
    delete process.env.LATE_API_KEY;
    const { LateClient } = await import('../../src/client/lateClient.js');
    const client = new LateClient();
    expect(() => client.sdk).toThrowError(
      'Late API key not configured. Set LATE_API_KEY environment variable.',
    );
  });

  it('LateClient passes the API key to the Late constructor', async () => {
    const { Late } = await import('@getlatedev/node');
    const { LateClient } = await import('../../src/client/lateClient.js');
    const client = new LateClient();
    client.ensureClient();
    expect(Late).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
  });
});
