import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { textResponse, errorResponse } from '../../src/types/tools.js';
import { loadConfig, saveConfig, getLateApiKey, CONFIG_FILE } from '../../src/config/config.js';
import {
  loadScheduleConfig,
  validateScheduleConfig,
  getSlotsForPlatform,
  normalizePlatform,
  PLATFORM_ALIASES,
} from '../../src/config/scheduleConfig.js';
import type { ScheduleConfig } from '../../src/types/schedule.js';

vi.mock('node:fs');

describe('types/tools', () => {
  it('textResponse returns correct MCP shape', () => {
    const res = textResponse('hello');
    expect(res).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(res.isError).toBeUndefined();
  });

  it('errorResponse returns MCP shape with isError', () => {
    const res = errorResponse('something broke');
    expect(res).toEqual({
      content: [{ type: 'text', text: 'something broke' }],
      isError: true,
    });
  });
});

describe('config/config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loadConfig returns parsed config when file exists', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ lateApiKey: 'test-key' }));
    const config = loadConfig();
    expect(config).toEqual({ lateApiKey: 'test-key' });
    expect(fs.readFileSync).toHaveBeenCalledWith(CONFIG_FILE, 'utf-8');
  });

  it('loadConfig returns empty object when file not found', () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw err; });
    expect(loadConfig()).toEqual({});
  });

  it('loadConfig throws on non-ENOENT errors', () => {
    const err = new Error('permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw err; });
    expect(() => loadConfig()).toThrow('Failed to read config file');
  });

  it('saveConfig writes JSON to disk', () => {
    saveConfig({ lateApiKey: 'abc', scheduleConfigPath: './sched.json' });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_FILE,
      expect.stringContaining('"lateApiKey": "abc"'),
      'utf-8',
    );
  });

  it('getLateApiKey prefers env var over config file', () => {
    process.env.LATE_API_KEY = 'env-key';
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ lateApiKey: 'file-key' }));
    expect(getLateApiKey()).toBe('env-key');
  });

  it('getLateApiKey falls back to config file', () => {
    delete process.env.LATE_API_KEY;
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ lateApiKey: 'file-key' }));
    expect(getLateApiKey()).toBe('file-key');
  });

  it('getLateApiKey returns undefined when neither source has key', () => {
    delete process.env.LATE_API_KEY;
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw err; });
    expect(getLateApiKey()).toBeUndefined();
  });
});

const VALID_SCHEDULE: ScheduleConfig = {
  timezone: 'America/Chicago',
  platforms: {
    tiktok: {
      slots: [
        { days: ['mon', 'wed', 'fri'], time: '09:00', label: 'morning' },
        { days: ['tue', 'thu'], time: '18:00', label: 'evening' },
      ],
      avoidDays: ['sun'],
      byClipType: {
        short: {
          slots: [{ days: ['mon', 'tue'], time: '12:00', label: 'noon-short' }],
          avoidDays: [],
        },
      },
    },
    x: {
      slots: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '10:00', label: 'workday' }],
      avoidDays: ['sat', 'sun'],
    },
  },
};

describe('config/scheduleConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('PLATFORM_ALIASES', () => {
    it('maps twitter <-> x bidirectionally', () => {
      expect(PLATFORM_ALIASES.twitter).toBe('x');
      expect(PLATFORM_ALIASES.x).toBe('twitter');
    });
  });

  describe('normalizePlatform', () => {
    it('returns platform as-is when it exists in config', () => {
      expect(normalizePlatform('tiktok', VALID_SCHEDULE)).toBe('tiktok');
    });

    it('resolves alias when platform not in config but alias is', () => {
      expect(normalizePlatform('twitter', VALID_SCHEDULE)).toBe('x');
    });

    it('returns original name when neither platform nor alias found', () => {
      expect(normalizePlatform('mastodon', VALID_SCHEDULE)).toBe('mastodon');
    });
  });

  describe('validateScheduleConfig', () => {
    it('accepts valid config', () => {
      expect(validateScheduleConfig(VALID_SCHEDULE)).toBe(true);
    });

    it('rejects null', () => {
      expect(validateScheduleConfig(null)).toBe(false);
    });

    it('rejects missing timezone', () => {
      expect(validateScheduleConfig({ platforms: { x: { slots: [], avoidDays: [] } } })).toBe(false);
    });

    it('rejects empty platforms', () => {
      expect(validateScheduleConfig({ timezone: 'UTC', platforms: {} })).toBe(false);
    });

    it('rejects platform without slots array', () => {
      expect(validateScheduleConfig({
        timezone: 'UTC',
        platforms: { x: { avoidDays: [] } },
      })).toBe(false);
    });

    it('rejects non-object', () => {
      expect(validateScheduleConfig('string')).toBe(false);
    });
  });

  describe('getSlotsForPlatform', () => {
    it('returns platform-level slots', () => {
      const slots = getSlotsForPlatform(VALID_SCHEDULE, 'tiktok');
      expect(slots).toHaveLength(2);
      expect(slots[0].label).toBe('morning');
    });

    it('returns clip-type slots when clipType specified and exists', () => {
      const slots = getSlotsForPlatform(VALID_SCHEDULE, 'tiktok', 'short');
      expect(slots).toHaveLength(1);
      expect(slots[0].label).toBe('noon-short');
    });

    it('falls back to platform slots when clipType not found', () => {
      const slots = getSlotsForPlatform(VALID_SCHEDULE, 'tiktok', 'unknown-type');
      expect(slots).toHaveLength(2);
    });

    it('resolves platform aliases', () => {
      const slots = getSlotsForPlatform(VALID_SCHEDULE, 'twitter');
      expect(slots).toHaveLength(1);
      expect(slots[0].label).toBe('workday');
    });

    it('returns empty array for unknown platform', () => {
      expect(getSlotsForPlatform(VALID_SCHEDULE, 'mastodon')).toEqual([]);
    });
  });

  describe('loadScheduleConfig', () => {
    it('loads from ./schedule.json when it exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === path.resolve('schedule.json'),
      );
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(VALID_SCHEDULE));

      const config = loadScheduleConfig();
      expect(config).toEqual(VALID_SCHEDULE);
    });

    it('falls back to config.scheduleConfigPath', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === path.resolve('schedule.json')) return false;
        if (String(p) === path.resolve('custom/sched.json')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (String(p).includes('late-social-mcp.config.json')) {
          return JSON.stringify({ scheduleConfigPath: 'custom/sched.json' });
        }
        return JSON.stringify(VALID_SCHEDULE);
      });

      const config = loadScheduleConfig();
      expect(config).toEqual(VALID_SCHEDULE);
    });

    it('returns null when no schedule file found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw err; });

      expect(loadScheduleConfig()).toBeNull();
    });

    it('throws on malformed schedule.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not json {{{');

      expect(() => loadScheduleConfig()).toThrow('Failed to parse schedule.json');
    });
  });
});
