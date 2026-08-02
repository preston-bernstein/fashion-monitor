# 08 — MCP Interactive Search (v2)

## Concept

This document specifies the interactive search mode built on MCP: v2 of Fashion Monitor's search capability.

The autonomous monitor (v1) is a push system. It runs on a schedule, scores listings in the background, and alerts you through Telegram. MCP interactive mode is a pull system: an LLM client (Claude Desktop, an Ollama frontend, or similar) calls search tools on demand and scores results directly inside an active conversation.

The two modes serve different purposes and can run independently:

| Mode | Trigger | Scoring | Output |
|------|---------|---------|--------|
| Autonomous monitor | Cron schedule | Separate LLM API call | Telegram alert |
| MCP interactive | User prompt | In LLM context window | Conversation results |

---

## Reference implementation

`~/dev/financial-pipeline` is a separate repo with a working example of this exact architecture: the same SDK, the same SSE transport, the same one-file-per-tool pattern, and the same monorepo layout. Read it before you build this. Key paths:

- `services/mcp-server/src/index.ts` — server setup, SSE transport, tool registration
- `services/mcp-server/src/tools/` — one file per tool
- `packages/adapter-utils/src/with-run-record.ts` — run tracking wrapper
- `packages/adapter-utils/src/logger.ts` — pino logger factory
- `docker-compose.yml` — how the MCP server is wired into Docker

---

## Monorepo structure

Adopt the same split between `packages/` and `services/`:

```
fashion-monitor/
  packages/
    db/               -- SQLite client, schema, migrations
    scraper-utils/    -- shared fetch helpers, normalization, withRunRecord
  services/
    monitor/          -- autonomous cron runner (v1)
    mcp-server/       -- interactive MCP server (v2)
  config.toml         -- domain config (switch from YAML — see below)
  .env                -- secrets only
  docker-compose.yml
```

---

## MCP server implementation

### `services/mcp-server/src/index.ts`

This file is copied directly from financial-pipeline's pattern. It uses SSE transport; Claude Desktop connects to it at `http://NAS_IP:3102/sse`.

```typescript
import 'dotenv/config';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { createLogger } from '@fashion-monitor/scraper-utils';
import { searchListings } from './tools/search-listings.js';
import { addSearchQuery } from './tools/add-search-query.js';
import { getRecentAlerts } from './tools/get-recent-alerts.js';

const log = createLogger('mcp-server');
const PORT = Number(process.env.MCP_PORT ?? 3102);

// cast avoids TS2589 — McpServer accumulates deep generics per registered tool
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = new McpServer({ name: 'fashion-monitor', version: '0.0.1' }) as any;

server.tool(
  'search_listings',
  'Search resale platforms for clothing matching a query. Returns raw listings pre-filtered by size and price — score them yourself against the aesthetic prompt.',
  {
    query: z.string(),
    platforms: z.array(z.enum(['ebay', 'grailed', 'vestiaire', 'depop', 'poshmark'])).optional(),
    size: z.string().optional(),
    price_max: z.number().optional(),
    limit: z.number().min(1).max(40).optional(),
  },
  searchListings
);

server.tool(
  'add_search_query',
  'Add a new search query to the autonomous monitor config. It will run on the next scheduled cycle.',
  {
    query: z.string(),
    platforms: z.array(z.enum(['ebay', 'grailed', 'vestiaire', 'depop', 'poshmark'])).optional(),
    label: z.string().optional(),
  },
  addSearchQuery
);

server.tool(
  'get_recent_alerts',
  'Return recent alerts sent by the autonomous monitor.',
  {
    limit: z.number().optional(),
    since: z.string().optional(),  // ISO8601
  },
  getRecentAlerts
);

const transports = new Map<string, SSEServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => transports.delete(transport.sessionId));
    await server.connect(transport);
    return;
  }
  if (req.method === 'POST' && req.url === '/messages') {
    const sessionId = req.headers['x-session-id'] as string;
    const transport = transports.get(sessionId);
    if (!transport) { res.writeHead(404).end(); return; }
    await transport.handlePostMessage(req, res);
    return;
  }
  res.writeHead(404).end();
});

httpServer.listen(PORT, () => log.info({ port: PORT }, 'mcp-server listening'));
```

### Tool file pattern

Each tool gets its own file, with its Zod schema defined inside that file. Each handler returns
`{ content: [{ type: 'text', text: JSON.stringify(...) }] }`.

```typescript
// services/mcp-server/src/tools/search-listings.ts
import { z } from 'zod';
import { searchEbay } from '@fashion-monitor/scraper-utils';
import { searchGrailed } from '@fashion-monitor/scraper-utils';
// ... other platform imports

const schema = z.object({
  query: z.string(),
  platforms: z.array(z.string()).optional(),
  size: z.string().optional(),
  price_max: z.number().optional(),
  limit: z.number().optional(),
});

export async function searchListings(args: z.infer<typeof schema>) {
  const platforms = args.platforms ?? ['ebay', 'grailed', 'depop', 'poshmark'];
  const limit = args.limit ?? 20;

  // fire all platform searches in parallel — same pattern as getFinancialSnapshot
  const results = await Promise.allSettled(
    platforms.map(p => searchPlatform(p, args.query, { size: args.size, priceMax: args.price_max, limit }))
  );

  const listings = results
    .filter((r): r is PromiseFulfilledResult<Listing[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(listings) }],
  };
}
```

Use `Promise.allSettled`, not `Promise.all` — one platform failing should not block the rest. This is the same resilience pattern financial-pipeline uses in `getFinancialSnapshot`.

### `services/mcp-server/package.json`

```json
{
  "name": "@fashion-monitor/mcp-server",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@fashion-monitor/db": "*",
    "@fashion-monitor/scraper-utils": "*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.0.0",
    "pino": "^9.0.0",
    "smol-toml": "^1.3.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

---

## Shared package: `scraper-utils`

This package mirrors financial-pipeline's `adapter-utils` package. It exports:

```typescript
// packages/scraper-utils/src/index.ts
export { withRunRecord } from './with-run-record.js';   // lifted verbatim from financial-pipeline
export { createLogger } from './logger.js';              // lifted verbatim
export { searchEbay } from './platforms/ebay.js';
export { searchGrailed } from './platforms/grailed.js';
export { searchDepop } from './platforms/depop.js';
export { searchPoshmark } from './platforms/poshmark.js';
export { searchVestiaire } from './platforms/vestiaire.js';
export type { Listing, Platform } from './types.js';
```

Platform search functions must be pure: given an input, they return a normalized `Listing[]` array, with no database writes and no side effects. The autonomous monitor writes to `seen_listings`; MCP interactive searches must not. Both entry points work off the same data, through two different paths.

---

## Config: switch YAML → TOML

financial-pipeline uses `smol-toml` for its domain config. Switch Fashion Monitor's config from `config.yaml` to `config.toml` to stay consistent with it:

```toml
# config.toml

profile_id = "default"

[measurements]
height = "YOUR_HEIGHT"
weight_lbs = 250
chest_in = "YOUR_CHEST_SIZE"
waist_in = 44
pants_size = "40-42"
dress_shirt_neck = 18
dress_shirt_sleeve = "34-35"
typical_size = "XXL"

[aesthetic]
prompt = """
Dark academic / textured naturalist. Natural textures, quality fabric, intentional
not costume-y. Tweed, twill, corduroy (wide wale preferred), slub cotton, dark linen,
Italian fabrics, structured knits. Dark palette: black, charcoal, navy, dark brown,
burgundy, forest green. No graphics, no embroidery gimmicks, no tropical prints,
no slim fit. Climate: Atlanta GA — breathable natural fabrics preferred year-round;
heavy wool/tweed OK for fall/winter. References: Nick Cave, Brian Jonestown Massacre,
Beastie Boys late 90s.
"""

hard_no = [
  "graphic tees or graphic prints",
  "embroidery as decoration",
  "tropical, floral, or vacation prints",
  "athletic or sportswear styling",
  "loud or oversized logos",
  "light colors (white, cream, pastels, light grey)",
  "slim fit or tailored slim",
]

[aesthetic.positive_signals]
strong = [
  "corduroy, tweed, twill, waffle knit, bouclé, herringbone, slub cotton, brushed cotton, linen, suede",
  "Italian cotton, Pima, Supima, merino, cashmere blend",
  "black, charcoal, dark grey, navy, dark brown, burgundy, forest green, slate, deep olive",
  "unstructured, relaxed fit, boxy, patch pockets",
  "made in Italy, Japan, USA, Portugal",
]
weak = [
  "Japanese or Scandinavian brand",
  "deadstock or NOS",
  "high original retail price",
]

[price_ceiling]
tops = 300
pants = 250
outerwear = 500
default = 300

[platforms]
ebay = true
grailed = true
vestiaire = true
vinted = false
depop = true
poshmark = true

[alert]
telegram_bot_token = "${TELEGRAM_BOT_TOKEN}"
telegram_chat_id = "${TELEGRAM_CHAT_ID}"
mode = "immediate"
notify_empty = false
```

---

## Docker Compose addition

Add to the existing `docker-compose.yml` alongside the autonomous monitor:

```yaml
mcp-server:
  image: fashion-monitor/mcp-server
  build:
    context: .
    dockerfile: services/mcp-server/Dockerfile
    platforms: ["linux/amd64"]
  environment:
    MCP_PORT: ${MCP_PORT}
  ports:
    - "${MCP_PORT}:${MCP_PORT}"
  volumes:
    - ./config.toml:/config/config.toml:ro
    - ./data/fashion_monitor.db:/data/fashion_monitor.db
  env_file: .env
```

The config file is mounted read-only. The database volume is shared with the autonomous monitor service. The MCP server reads `alert_log` and `seen_listings`, but never writes to `seen_listings` — see the constraint below.

---

## Claude Desktop config

```json
{
  "mcpServers": {
    "fashion-monitor": {
      "url": "http://NAS_IP:3102/sse"
    }
  }
}
```

---

## Key constraint: MCP searches must not write `seen_listings`

The autonomous monitor uses `seen_listings` for deduplication. If an interactive search marked a listing as seen, the monitor would never alert on it, even if it's a genuine match.

Platform adapter functions must be pure. The monitor pipeline calls them and then writes to `seen_listings` itself. The MCP server calls the same functions and does nothing further. Enforce this at the type level: search functions return `Listing[]` only, and deduplication happens as a separate step, in the monitor pipeline alone.

---

## Scoring in interactive mode

The MCP server returns raw listings only. The LLM already active in the conversation scores them, using the aesthetic prompt from `config.toml`. No separate LLM API call is needed, since the model already has the context.

Expose the aesthetic prompt as an MCP resource so the client loads it automatically at the start of a session:

```typescript
server.resource(
  'aesthetic-prompt',
  'fashion-monitor://profile/default/aesthetic-prompt',
  async () => ({
    contents: [{ uri: 'fashion-monitor://profile/default/aesthetic-prompt', text: config.aesthetic.prompt }],
  })
);
```

---

## LLM client notes

| Client | MCP support | Notes |
|--------|-------------|-------|
| Claude Desktop | Native | Recommended — connects via SSE URL |
| Cursor IDE | Native | Good for dev sessions |
| Ollama frontends | Via bridge | Open WebUI supports MCP; local models weak on subtle aesthetic signals |
| ChatGPT | Not supported | OpenAI Actions is a different protocol |

---

## Implementation order

1. Refactor platform adapters into pure `search(query, options) → Listing[]` functions with no database writes. This is a prerequisite for everything else.
2. Create `packages/scraper-utils`, carrying over `withRunRecord` and `createLogger` from financial-pipeline.
3. Migrate `config.yaml` to `config.toml` using `smol-toml`.
4. Scaffold `services/mcp-server` from financial-pipeline's mcp-server structure.
5. Implement the `search_listings` tool, using `Promise.allSettled` across platforms.
6. Implement `get_recent_alerts`, reading from `alert_log`.
7. Implement `add_search_query`, writing to `config.toml`.
8. Expose the aesthetic prompt as an MCP resource.
9. Wire it into Docker Compose and test with Claude Desktop.
