#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from './session-manager.js';
import { getToolDefinitions, handleToolCall } from './tools/index.js';

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

  // Create MCP server
  const server = new Server(
    {
      name: 'mcproxy',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getToolDefinitions(),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(sessionManager, name, args ?? {});

      // Handle screenshot specially - return as image content (with optional file save info)
      if (name === 'browser_screenshot' && result && typeof result === 'object') {
        const screenshotResult = result as { data: string; mimeType: string; saved_to?: string };
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

        // If saved to file, include the path
        if (screenshotResult.saved_to) {
          content.push({
            type: 'text',
            text: `Screenshot saved to: ${screenshotResult.saved_to}`,
          });
        }

        content.push({
          type: 'image',
          data: screenshotResult.data,
          mimeType: screenshotResult.mimeType,
        });

        return { content };
      }

      // Handle CAPTCHA check - include screenshot as image for agent to analyze
      if (name === 'browser_check_captcha' && result && typeof result === 'object') {
        const captchaResult = result as {
          detected: boolean;
          screenshot?: string;
          fullPageScreenshot?: string;
          [key: string]: unknown;
        };

        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

        // Add text summary (without the base64 data to keep it readable)
        const textResult = { ...captchaResult };
        delete textResult.screenshot;
        delete textResult.fullPageScreenshot;
        content.push({
          type: 'text',
          text: JSON.stringify(textResult, null, 2),
        });

        // Add CAPTCHA element screenshot if present
        if (captchaResult.screenshot) {
          content.push({
            type: 'image',
            data: captchaResult.screenshot,
            mimeType: 'image/png',
          });
        }

        // Add full page screenshot for context
        if (captchaResult.fullPageScreenshot) {
          content.push({
            type: 'image',
            data: captchaResult.fullPageScreenshot,
            mimeType: 'image/png',
          });
        }

        return { content };
      }

      // Handle navigate with CAPTCHA - include screenshot if CAPTCHA detected
      if (name === 'browser_navigate' && result && typeof result === 'object') {
        const navResult = result as {
          url: string;
          title: string;
          captcha?: {
            detected: boolean;
            screenshot?: string;
            fullPageScreenshot?: string;
            [key: string]: unknown;
          };
        };

        if (navResult.captcha?.detected) {
          const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

          // Add text summary
          const textResult = {
            ...navResult,
            captcha: { ...navResult.captcha },
          };
          delete textResult.captcha.screenshot;
          delete textResult.captcha.fullPageScreenshot;
          content.push({
            type: 'text',
            text: JSON.stringify(textResult, null, 2),
          });

          // Add CAPTCHA screenshot
          if (navResult.captcha.screenshot) {
            content.push({
              type: 'image',
              data: navResult.captcha.screenshot,
              mimeType: 'image/png',
            });
          }

          // Add full page screenshot
          if (navResult.captcha.fullPageScreenshot) {
            content.push({
              type: 'image',
              data: navResult.captcha.fullPageScreenshot,
              mimeType: 'image/png',
            });
          }

          return { content };
        }
      }

      // Return result as text
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

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
