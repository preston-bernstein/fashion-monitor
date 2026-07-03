import { describe, expect, it } from 'vitest';
import type { Config } from '@fm/core/core/config.js';
import { createGetTaste } from '../../src/tools/get-taste.js';

function minimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    profile_id: 'default',
    aesthetic_prompt: 'Dark academic aesthetic.',
    hard_no: ['slim fit'],
    positive_signals: { strong: ['corduroy'], weak: [] },
    price_ceiling: { default: 300 },
    measurements: { typical_size: 'XXL' },
    platforms: { ebay: true, grailed: true, vestiaire: false, vinted: false, depop: false, poshmark: false },
    llm: {
      provider: 'mock',
      batch_size: 15,
      ollama_text_model: 'qwen2.5:7b',
      claude_model: 'claude-haiku-4-5',
      vision_backend: 'ollama',
    },
    alert: { ntfy_url: 'http://ntfy-test', ntfy_topic: 'test', mode: 'immediate', notify_empty: false },
    database: { path: ':memory:' },
    scraper: { poshmark_profile_path: 'data/poshmark-profile' },
    ...overrides,
  } as Config;
}

describe('get_taste MCP tool', () => {
  it('returns the aesthetic prompt, hard-no rules, signals, price ceiling, and measurements', async () => {
    const getTaste = createGetTaste(minimalConfig());
    const result = await getTaste();
    const body = JSON.parse(result.content[0].text);

    expect(body).toEqual({
      aesthetic_prompt: 'Dark academic aesthetic.',
      hard_no: ['slim fit'],
      positive_signals: { strong: ['corduroy'], weak: [] },
      price_ceiling: { default: 300 },
      measurements: { typical_size: 'XXL' },
    });
  });

  it('reflects whatever config it was constructed with (no caching across instances)', async () => {
    const first = createGetTaste(minimalConfig({ aesthetic_prompt: 'First prompt' }));
    const second = createGetTaste(minimalConfig({ aesthetic_prompt: 'Second prompt' }));

    expect(JSON.parse((await first()).content[0].text).aesthetic_prompt).toBe('First prompt');
    expect(JSON.parse((await second()).content[0].text).aesthetic_prompt).toBe('Second prompt');
  });
});
