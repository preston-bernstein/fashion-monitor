import type { Config } from '@fm/core/core/config.js';

/**
 * Factory so the handler can be exercised in tests against a plain Config
 * object, without going through `../context.js`'s module-scope config
 * wiring (which reads from disk via env vars at import time). `index.ts`
 * binds this to the real `config` at startup.
 */
export function createGetTaste(config: Config) {
  return async function getTaste() {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            aesthetic_prompt: config.aesthetic_prompt,
            hard_no: config.hard_no,
            positive_signals: config.positive_signals,
            price_ceiling: config.price_ceiling,
            measurements: config.measurements,
          }),
        },
      ],
    };
  };
}
