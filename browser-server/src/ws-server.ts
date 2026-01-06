import { WebSocketServer, WebSocket } from 'ws';
import type {
  ClientMessage,
  AuthMessage,
  CommandMessage,
  ResponseMessage,
  ErrorMessage,
  AuthResultMessage,
  PongMessage,
} from '@mcproxy/shared';
import { CommandHandler } from './command-handler.js';

interface AuthenticatedClient {
  ws: WebSocket;
  authenticated: boolean;
  contextIds: Set<string>;  // Track contexts owned by this connection
}

export class BrowserWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, AuthenticatedClient> = new Map();
  private authToken: string;
  private commandHandler: CommandHandler;

  constructor(options: {
    authToken: string;
    commandHandler: CommandHandler;
  }) {
    this.authToken = options.authToken;
    this.commandHandler = options.commandHandler;
  }

  start(port: number): void {
    this.wss = new WebSocketServer({ port });
    console.log(`WebSocket server listening on port ${port}`);

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New connection');
      this.clients.set(ws, { ws, authenticated: false, contextIds: new Set() });

      // Set auth timeout - client must authenticate within 10 seconds
      const authTimeout = setTimeout(() => {
        const client = this.clients.get(ws);
        if (client && !client.authenticated) {
          console.log('Client failed to authenticate in time, closing connection');
          ws.close(4001, 'Authentication timeout');
        }
      }, 10000);

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          await this.handleMessage(ws, message, authTimeout);
        } catch (err) {
          console.error('Error handling message:', err);
          this.sendError(ws, 'unknown', 'PARSE_ERROR', 'Failed to parse message');
        }
      });

      ws.on('close', async () => {
        const client = this.clients.get(ws);
        if (client && client.contextIds.size > 0) {
          console.log(`Connection closed, cleaning up ${client.contextIds.size} context(s)`);
          // Close all browser contexts owned by this connection
          for (const contextId of client.contextIds) {
            try {
              await this.commandHandler.handleCommand('close_context', { contextId });
              console.log(`Cleaned up context ${contextId}`);
            } catch (err) {
              console.error(`Failed to clean up context ${contextId}:`, err);
            }
          }
        } else {
          console.log('Connection closed');
        }
        clearTimeout(authTimeout);
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.clients.delete(ws);
      });
    });
  }

  stop(): void {
    if (this.wss) {
      // Close all client connections
      for (const client of this.clients.values()) {
        client.ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();

      this.wss.close();
      this.wss = null;
      console.log('WebSocket server stopped');
    }
  }

  private async handleMessage(
    ws: WebSocket,
    message: ClientMessage,
    authTimeout: NodeJS.Timeout
  ): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    // Handle auth message
    if (message.type === 'auth') {
      clearTimeout(authTimeout);
      await this.handleAuth(ws, client, message);
      return;
    }

    // Handle ping (heartbeat)
    if (message.type === 'ping') {
      this.sendPong(ws);
      return;
    }

    // All other messages require authentication
    if (!client.authenticated) {
      this.sendError(ws, 'unknown', 'NOT_AUTHENTICATED', 'Must authenticate first');
      return;
    }

    // Handle command
    if (message.type === 'command') {
      await this.handleCommand(ws, message);
      return;
    }
  }

  private async handleAuth(
    ws: WebSocket,
    client: AuthenticatedClient,
    message: AuthMessage
  ): Promise<void> {
    if (message.token === this.authToken) {
      client.authenticated = true;
      console.log('Client authenticated successfully');
      this.sendAuthResult(ws, true);
    } else {
      console.log('Client authentication failed: invalid token');
      this.sendAuthResult(ws, false, 'Invalid token');
      ws.close(4003, 'Authentication failed');
    }
  }

  private async handleCommand(ws: WebSocket, message: CommandMessage): Promise<void> {
    const { id, command, params } = message;
    const client = this.clients.get(ws);

    try {
      console.log(`Handling command: ${command} (${id})`);
      const result = await this.commandHandler.handleCommand(command, params);

      // Track context ownership for cleanup on disconnect
      if (client) {
        if (command === 'create_context' && result && typeof result === 'object' && 'contextId' in result) {
          client.contextIds.add((result as { contextId: string }).contextId);
        } else if (command === 'close_context' && params && typeof params === 'object' && 'contextId' in params) {
          client.contextIds.delete((params as { contextId: string }).contextId);
        }
      }

      this.sendResponse(ws, id, result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Command ${command} failed:`, errorMessage);
      this.sendError(ws, id, 'COMMAND_FAILED', errorMessage);
    }
  }

  private sendAuthResult(ws: WebSocket, success: boolean, error?: string): void {
    const message: AuthResultMessage = {
      type: 'auth_result',
      success,
      ...(error && { error }),
    };
    ws.send(JSON.stringify(message));
  }

  private sendResponse(ws: WebSocket, id: string, result: unknown): void {
    const message: ResponseMessage = {
      id,
      type: 'response',
      success: true,
      result,
    };
    ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, id: string, code: string, errorMessage: string): void {
    const message: ErrorMessage = {
      id,
      type: 'error',
      error: { code, message: errorMessage },
    };
    ws.send(JSON.stringify(message));
  }

  private sendPong(ws: WebSocket): void {
    const message: PongMessage = { type: 'pong' };
    ws.send(JSON.stringify(message));
  }
}
