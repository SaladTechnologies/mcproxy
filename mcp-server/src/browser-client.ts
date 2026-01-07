import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  CommandType,
  CommandParams,
  ClientMessage,
  ServerMessage,
  ResponseMessage,
  ErrorMessage,
} from '@mcproxy/shared';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class BrowserClient {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private onDisconnect?: () => void;

  constructor(
    private endpoint: string,
    private authToken: string,
    private options: {
      heartbeatIntervalMs?: number;
      commandTimeoutMs?: number;
    } = {}
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.error(`Connecting to ${this.endpoint}...`);

      this.ws = new WebSocket(this.endpoint);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 30000);

      this.ws.on('open', async () => {
        clearTimeout(connectTimeout);
        try {
          await this.authenticate();
          this.startHeartbeat();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        console.error(`WebSocket closed: ${code} ${reason.toString()}`);
        this.cleanup();
        this.onDisconnect?.();
      });

      this.ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        clearTimeout(connectTimeout);
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  setOnDisconnect(callback: () => void): void {
    this.onDisconnect = callback;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  async sendCommand(command: CommandType, params: CommandParams): Promise<unknown> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    const id = uuidv4();
    const timeoutMs = this.options.commandTimeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const message: ClientMessage = {
        id,
        type: 'command',
        command,
        params,
      };

      this.ws!.send(JSON.stringify(message));
    });
  }

  private async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 10000);

      // Set up one-time handler for auth result
      const authHandler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as ServerMessage;
          if (message.type === 'auth_result') {
            clearTimeout(authTimeout);
            this.ws?.off('message', authHandler);

            if (message.success) {
              this.authenticated = true;
              console.error('Authenticated successfully');
              resolve();
            } else {
              reject(new Error(`Authentication failed: ${message.error}`));
            }
          }
        } catch (err) {
          clearTimeout(authTimeout);
          reject(err);
        }
      };

      this.ws.on('message', authHandler);

      // Send auth message
      const authMessage: ClientMessage = {
        type: 'auth',
        token: this.authToken,
      };
      this.ws.send(JSON.stringify(authMessage));
    });
  }

  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as ServerMessage;

      if (message.type === 'pong') {
        // Heartbeat response, nothing to do
        return;
      }

      if (message.type === 'response' || message.type === 'error') {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.type === 'response') {
            pending.resolve((message as ResponseMessage).result);
          } else {
            pending.reject(new Error((message as ErrorMessage).error.message));
          }
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }

  private startHeartbeat(): void {
    const intervalMs = this.options.heartbeatIntervalMs ?? 30000;

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingMessage: ClientMessage = { type: 'ping' };
        this.ws.send(JSON.stringify(pingMessage));
      }
    }, intervalMs);
  }

  private cleanup(): void {
    this.authenticated = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }
}
