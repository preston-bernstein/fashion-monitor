import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parseConfig, type Config } from "./config.js";
import { ConfigError } from "./errors.js";

export function loadConfigFromFile(path: string): Config {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parseYaml(raw);
    return parseConfig(parsed);
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      throw new ConfigError(`Invalid config: ${err.message}`);
    }
    throw err;
  }
}

export function loadConfigFromObject(raw: unknown): Config {
  return parseConfig(raw);
}
