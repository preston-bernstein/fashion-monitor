import { config as dotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { loadConfigFromFile } from '@fm/core/core/load-config.js';
import { openDatabase, migrate } from '@fm/core/storage/db.js';
import type { Config } from '@fm/core/core/config.js';
import type { Db } from '@fm/core/storage/db.js';

const configPath = resolve(process.env.MCP_CONFIG_PATH ?? 'config.yaml');
// load .env from the same directory as config.yaml so env var substitution works
dotenv({ path: resolve(dirname(configPath), '.env') });

export const config: Config = loadConfigFromFile(configPath);

const dbPath = resolve(process.env.DB_PATH ?? config.database.path);
export const db: Db = openDatabase(dbPath);
migrate(db);
