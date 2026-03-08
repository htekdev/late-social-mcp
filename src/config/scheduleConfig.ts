import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScheduleConfig, TimeSlot } from '../types/schedule.js';
import { loadConfig } from './config.js';

export const PLATFORM_ALIASES: Record<string, string> = {
  twitter: 'x',
  x: 'twitter',
};

export function normalizePlatform(platform: string, config: ScheduleConfig): string {
  if (config.platforms[platform]) {
    return platform;
  }
  const alias = PLATFORM_ALIASES[platform];
  if (alias && config.platforms[alias]) {
    return alias;
  }
  return platform;
}

export function loadScheduleConfig(): ScheduleConfig | null {
  const localPath = path.resolve('schedule.json');
  if (fs.existsSync(localPath)) {
    try {
      const raw = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(raw) as ScheduleConfig;
    } catch (err: unknown) {
      throw new Error(`Failed to parse schedule.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const appConfig = loadConfig();
  if (appConfig.scheduleConfigPath) {
    const configPath = path.resolve(appConfig.scheduleConfigPath);
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw) as ScheduleConfig;
      } catch (err: unknown) {
        throw new Error(`Failed to parse schedule config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return null;
}

export function validateScheduleConfig(config: unknown): config is ScheduleConfig {
  if (config === null || typeof config !== 'object') {
    return false;
  }

  const candidate = config as Record<string, unknown>;

  if (typeof candidate.timezone !== 'string' || candidate.timezone.length === 0) {
    return false;
  }

  if (candidate.platforms === null || typeof candidate.platforms !== 'object') {
    return false;
  }

  const platforms = candidate.platforms as Record<string, unknown>;
  if (Object.keys(platforms).length === 0) {
    return false;
  }

  for (const [, platformConfig] of Object.entries(platforms)) {
    if (platformConfig === null || typeof platformConfig !== 'object') {
      return false;
    }
    const pc = platformConfig as Record<string, unknown>;
    if (!Array.isArray(pc.slots)) {
      return false;
    }
    if (!Array.isArray(pc.avoidDays)) {
      return false;
    }
  }

  return true;
}

export function getSlotsForPlatform(
  config: ScheduleConfig,
  platform: string,
  clipType?: string,
): TimeSlot[] {
  const normalized = normalizePlatform(platform, config);
  const platformSchedule = config.platforms[normalized];

  if (!platformSchedule) {
    return [];
  }

  if (clipType && platformSchedule.byClipType) {
    const clipSchedule = platformSchedule.byClipType[clipType];
    if (clipSchedule) {
      return clipSchedule.slots;
    }
  }

  return platformSchedule.slots;
}
