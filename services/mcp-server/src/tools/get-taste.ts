import { config } from '../context.js';

export async function getTaste() {
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
}
