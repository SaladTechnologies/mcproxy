import http from 'http';
import { BrowserManager } from './browser-manager.js';
import { CommandHandler } from './command-handler.js';
import { BrowserWebSocketServer } from './ws-server.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '8080', 10);
const MAX_CONTEXTS = parseInt(process.env.MAX_CONTEXTS ?? '10', 10);
const CONTEXT_TTL_MS = parseInt(process.env.CONTEXT_TTL_MS ?? '1800000', 10); // 30 min

const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('ERROR: AUTH_TOKEN environment variable is required');
  process.exit(1);
}
const authToken: string = AUTH_TOKEN;

async function main(): Promise<void> {
  console.log('Starting browser server...');
  console.log(`  Port: ${PORT}`);
  console.log(`  Health port: ${HEALTH_PORT}`);
  console.log(`  Max contexts: ${MAX_CONTEXTS}`);
  console.log(`  Context TTL: ${CONTEXT_TTL_MS}ms`);

  // Initialize browser manager
  const browserManager = new BrowserManager({
    maxContexts: MAX_CONTEXTS,
    contextTtlMs: CONTEXT_TTL_MS,
  });

  await browserManager.initialize();

  // Initialize command handler
  const commandHandler = new CommandHandler(browserManager);

  // Initialize WebSocket server
  const wsServer = new BrowserWebSocketServer({
    authToken,
    commandHandler,
  });

  wsServer.start(PORT);

  // Health check HTTP server
  const healthServer = http.createServer((req, res) => {
    const stats = browserManager.getStats();
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        contexts: stats.contextCount,
        maxContexts: stats.maxContexts,
      }));
    } else if (req.url === '/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: true }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  healthServer.listen(HEALTH_PORT, () => {
    console.log(`Health server listening on port ${HEALTH_PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, shutting down...`);
    healthServer.close();
    wsServer.stop();
    await browserManager.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('Browser server ready');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
