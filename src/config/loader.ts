/**
 * Configuration file loader
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ReposConfig } from '../types/index.js';

const DEFAULT_CONFIG_PATH = 'repos.json';

/**
 * Load repository configuration from file
 */
export async function loadConfig(configPath?: string): Promise<ReposConfig> {
  const path = configPath || join(process.cwd(), DEFAULT_CONFIG_PATH);

  try {
    const content = await readFile(path, 'utf-8');
    const config = JSON.parse(content) as ReposConfig;
    validateConfig(config);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Validate configuration structure
 */
function validateConfig(config: ReposConfig): void {
  if (!config.repositories || !Array.isArray(config.repositories)) {
    throw new Error('Configuration must have a "repositories" array');
  }

  if (config.repositories.length === 0) {
    throw new Error('Configuration must have at least one repository');
  }

  for (const repo of config.repositories) {
    if (!repo.owner || !repo.repo) {
      throw new Error('Each repository must have "owner" and "repo" fields');
    }
  }
}

/**
 * Create a default configuration for backward compatibility
 */
export function createDefaultConfig(owner: string, repo: string): ReposConfig {
  return {
    repositories: [{ owner, repo }],
  };
}
