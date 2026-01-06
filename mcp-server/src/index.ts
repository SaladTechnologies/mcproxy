#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionManager } from './session-manager.js';
import { registerTools } from './tools/index.js';

// Configuration from environment
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.MCPROXY_HEARTBEAT_INTERVAL_MS ?? process.env.HEARTBEAT_INTERVAL_MS ?? '60000',
  10
);
const COMMAND_TIMEOUT_MS = parseInt(
  process.env.MCPROXY_COMMAND_TIMEOUT_MS ?? process.env.COMMAND_TIMEOUT_MS ?? '30000',
  10
);

const AUTH_TOKEN = process.env.MCPROXY_AUTH_TOKEN ?? process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('ERROR: AUTH_TOKEN or MCPROXY_AUTH_TOKEN environment variable is required');
  process.exit(1);
}
const authToken: string = AUTH_TOKEN;

async function main(): Promise<void> {
  console.error('Starting MCP Browser Server...');
  console.error(`  Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);
  console.error(`  Command timeout: ${COMMAND_TIMEOUT_MS}ms`);

  // Initialize session manager
  const sessionManager = new SessionManager({
    authToken,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
  });

  // Create MCP server using the newer McpServer API
  const server = new McpServer({
    name: 'mcproxy',
    version: '1.2.0',
  });

  // Register all browser automation tools
  registerTools(server, sessionManager);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`\nReceived ${signal}, shutting down...`);
    await sessionManager.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Browser Server ready');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
