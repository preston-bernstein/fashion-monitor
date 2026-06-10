import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { IMPLEMENTED_PLATFORMS } from '@fm/shared/platforms.js';
import { searchListings } from './tools/search-listings.js';
import { getRecentAlerts } from './tools/get-recent-alerts.js';
import { addMonitor } from './tools/add-monitor.js';
import { getTaste } from './tools/get-taste.js';

const PORT = Number(process.env.MCP_PORT ?? 3102);

// cast avoids TS2589 — McpServer accumulates deep generics per registered tool
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = new McpServer({ name: 'fashion-monitor', version: '0.1.0' }) as any;

server.tool(
  'search_listings',
  'Search resale platforms for clothing. Returns raw listings pre-filtered by price — score them against the aesthetic prompt from get_taste.',
  {
    query: z.string().min(1).describe('Search query text'),
    platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).optional().describe('Platforms to search. Defaults to all.'),
    price_max: z.number().positive().optional().describe('Max price in USD'),
    limit: z.number().min(1).max(40).default(20).describe('Max listings to return'),
  },
  searchListings,
);

server.tool(
  'get_recent_alerts',
  'Return recent alerts sent by the autonomous monitor pipeline.',
  {
    limit: z.number().min(1).max(100).default(20).describe('Number of alerts to return'),
    since: z.string().optional().describe('ISO8601 datetime — only return alerts after this time'),
  },
  getRecentAlerts,
);

server.tool(
  'add_monitor',
  'Add a new Monitor (saved search) to the autonomous pipeline. It will run on the next scheduled cycle.',
  {
    query: z.string().min(1).describe('Search query text'),
    platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).optional().describe('Platforms to watch. Defaults to ebay, grailed, depop, poshmark.'),
    note: z.string().optional().describe('Optional curator note'),
  },
  addMonitor,
);

server.tool(
  'get_taste',
  'Return the current Taste config — aesthetic prompt, hard-no rules, positive signals, price ceilings, and measurements. Load this at session start so you can score listings yourself.',
  {},
  getTaste,
);

// SSE transport — connect via http://NAS_IP:3102/sse
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

httpServer.listen(PORT, () => {
  console.log(`fashion-monitor mcp-server listening on :${PORT}`);
});
