import { v4 as uuidv4 } from 'uuid';
import { BrowserClient } from './browser-client.js';
import type { CommandType, CommandParams, CreateContextResult, LocationInfo, BrowserType } from '@mcproxy/shared';

interface Session {
  sessionId: string;
  endpoint: string;
  contextId: string; // The context ID on the remote browser server
  browserType: BrowserType;
  client: BrowserClient;
  createdAt: number;
  location: LocationInfo;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private authToken: string;
  private heartbeatIntervalMs: number;
  private commandTimeoutMs: number;

  constructor(options: {
    authToken: string;
    heartbeatIntervalMs?: number;
    commandTimeoutMs?: number;
  }) {
    this.authToken = options.authToken;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30000;
  }

  async createSession(endpoint: string, options?: {
    browserType?: BrowserType;
    viewport?: { width: number; height: number };
    userAgent?: string;
    randomUserAgent?: boolean;
    device?: string;
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
  }): Promise<{ sessionId: string; endpoint: string; browserType: BrowserType; location: LocationInfo }> {
    const sessionId = uuidv4();

    // Create WebSocket client and connect
    const client = new BrowserClient(endpoint, this.authToken, {
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      commandTimeoutMs: this.commandTimeoutMs,
    });

    await client.connect();

    // Set up disconnect handler
    client.setOnDisconnect(() => {
      console.error(`Session ${sessionId} disconnected`);
      this.sessions.delete(sessionId);
    });

    // Create browser context on the remote server
    const result = await client.sendCommand('create_context', options ?? {}) as CreateContextResult;

    const session: Session = {
      sessionId,
      endpoint,
      contextId: result.contextId,
      browserType: result.browserType,
      client,
      createdAt: Date.now(),
      location: result.location,
    };

    this.sessions.set(sessionId, session);
    const loc = result.location;
    console.error(`Created ${result.browserType} session ${sessionId} -> ${endpoint} (context: ${result.contextId}, location: ${loc.city}, ${loc.regionCode}, ${loc.countryCode})`);

    return { sessionId, endpoint, browserType: result.browserType, location: result.location };
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Close the browser context on the remote server
      await session.client.sendCommand('close_context', { contextId: session.contextId });
    } catch (err) {
      console.error(`Error closing context for session ${sessionId}:`, err);
    }

    // Disconnect the WebSocket
    session.client.disconnect();
    this.sessions.delete(sessionId);
    console.error(`Closed session ${sessionId}`);
  }

  async sendCommand(sessionId: string, command: CommandType, params: Record<string, unknown> = {}): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Inject the actual contextId from the session
    const fullParams = {
      ...params,
      contextId: session.contextId,
    } as CommandParams;

    return session.client.sendCommand(command, fullParams);
  }

  listSessions(): Array<{
    sessionId: string;
    endpoint: string;
    browserType: BrowserType;
    createdAt: number;
    connected: boolean;
    location: LocationInfo;
  }> {
    return Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      endpoint: session.endpoint,
      browserType: session.browserType,
      createdAt: session.createdAt,
      connected: session.client.isConnected(),
      location: session.location,
    }));
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async shutdown(): Promise<void> {
    console.error('Shutting down session manager...');
    const closePromises = Array.from(this.sessions.keys()).map(sessionId =>
      this.closeSession(sessionId).catch(err => {
        console.error(`Error closing session ${sessionId}:`, err);
      })
    );
    await Promise.all(closePromises);
    console.error('Session manager shut down');
  }
}
