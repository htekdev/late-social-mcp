import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Config {
  lateApiKey?: string;
  scheduleConfigPath?: string;
}

export const CONFIG_FILE = path.resolve('late-social-mcp.config.json');

export function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new Error(`Failed to read config file ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function saveConfig(config: Config): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function getLateApiKey(): string | undefined {
  const envKey = process.env.LATE_API_KEY;
  if (envKey) {
    return envKey;
  }

  const config = loadConfig();
  return config.lateApiKey;
}
