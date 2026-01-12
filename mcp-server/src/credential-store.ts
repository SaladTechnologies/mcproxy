import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

/**
 * Credential Store for MCProxy
 *
 * Stores credentials locally so the AI model can reference them by name
 * without ever seeing the actual values. The model says "type credential X"
 * and the MCP server resolves X to the actual value before sending to browser.
 *
 * Credential sources (in order of precedence):
 * 1. Environment variables: MCPROXY_CREDENTIAL_<NAME> (uppercase, underscores)
 * 2. Credentials file: ~/.mcproxy/credentials.json
 *
 * Example credentials.json:
 * {
 *   "github_password": "my-secret-password",
 *   "api_key": "sk-123..."
 * }
 *
 * Example env var:
 * MCPROXY_CREDENTIAL_GITHUB_PASSWORD=my-secret-password
 */

export interface CredentialInfo {
  name: string;
  source: 'env' | 'file';
  // Note: value is intentionally NOT included - never expose to model
}

export class CredentialStore {
  private credentialsPath: string;
  private fileCredentials: Map<string, string> = new Map();
  private loaded = false;

  constructor(credentialsPath?: string) {
    this.credentialsPath = credentialsPath ?? join(homedir(), '.mcproxy', 'credentials.json');
  }

  /**
   * Load credentials from file (lazy-loaded on first access)
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      if (existsSync(this.credentialsPath)) {
        const content = await readFile(this.credentialsPath, 'utf-8');
        const parsed = JSON.parse(content);

        if (typeof parsed === 'object' && parsed !== null) {
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') {
              this.fileCredentials.set(key, value);
            }
          }
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid - that's fine, we'll use env vars
      console.error(`Warning: Could not load credentials file: ${error}`);
    }

    this.loaded = true;
  }

  /**
   * Convert credential name to environment variable name
   * github_password -> MCPROXY_CREDENTIAL_GITHUB_PASSWORD
   */
  private toEnvVarName(name: string): string {
    return `MCPROXY_CREDENTIAL_${name.toUpperCase().replace(/-/g, '_')}`;
  }

  /**
   * Get a credential value by name
   * Returns undefined if credential doesn't exist
   *
   * IMPORTANT: This value should NEVER be returned to the model.
   * It should only be used internally to send to the browser server.
   */
  async get(name: string): Promise<string | undefined> {
    // Check environment variable first (higher precedence)
    const envName = this.toEnvVarName(name);
    const envValue = process.env[envName];
    if (envValue !== undefined) {
      return envValue;
    }

    // Check file credentials
    await this.ensureLoaded();
    return this.fileCredentials.get(name);
  }

  /**
   * Check if a credential exists
   */
  async has(name: string): Promise<boolean> {
    const value = await this.get(name);
    return value !== undefined;
  }

  /**
   * List available credential names (NOT values)
   * Safe to return to the model
   */
  async list(): Promise<CredentialInfo[]> {
    await this.ensureLoaded();

    const credentials: CredentialInfo[] = [];
    const seen = new Set<string>();

    // Add env var credentials
    const envPrefix = 'MCPROXY_CREDENTIAL_';
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(envPrefix)) {
        const name = key.slice(envPrefix.length).toLowerCase().replace(/_/g, '-');
        credentials.push({ name, source: 'env' });
        seen.add(name);
      }
    }

    // Add file credentials (if not already from env)
    for (const name of this.fileCredentials.keys()) {
      if (!seen.has(name)) {
        credentials.push({ name, source: 'file' });
      }
    }

    return credentials.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Set a credential in the file store
   * Creates the credentials file if it doesn't exist
   */
  async set(name: string, value: string): Promise<void> {
    await this.ensureLoaded();

    // Update in-memory cache
    this.fileCredentials.set(name, value);

    // Write to file
    await this.save();
  }

  /**
   * Delete a credential from the file store
   * Note: Cannot delete env var credentials
   */
  async delete(name: string): Promise<boolean> {
    await this.ensureLoaded();

    if (this.fileCredentials.has(name)) {
      this.fileCredentials.delete(name);
      await this.save();
      return true;
    }

    return false;
  }

  /**
   * Save credentials to file
   */
  private async save(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [key, value] of this.fileCredentials) {
      obj[key] = value;
    }

    // Ensure directory exists
    await mkdir(dirname(this.credentialsPath), { recursive: true });

    // Write file with restricted permissions
    await writeFile(this.credentialsPath, JSON.stringify(obj, null, 2), { mode: 0o600 });
  }

  /**
   * Get the path to the credentials file
   */
  getCredentialsPath(): string {
    return this.credentialsPath;
  }

  /**
   * Scrub all known credential values from a string
   * Replaces actual values with [CREDENTIAL:name] placeholders
   *
   * This provides defense-in-depth: even if a credential value somehow
   * appears in a response (error message, HTML content, etc.), it will
   * be filtered out before being returned to the model.
   */
  async scrubCredentials(text: string): Promise<string> {
    await this.ensureLoaded();

    let result = text;

    // Build a list of all credentials to scrub (env + file)
    const credentialsToScrub: Array<{ name: string; value: string }> = [];

    // Add env var credentials
    const envPrefix = 'MCPROXY_CREDENTIAL_';
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(envPrefix) && value) {
        const name = key.slice(envPrefix.length).toLowerCase().replace(/_/g, '-');
        credentialsToScrub.push({ name, value });
      }
    }

    // Add file credentials
    for (const [name, value] of this.fileCredentials) {
      credentialsToScrub.push({ name, value });
    }

    // Sort by value length descending to replace longer values first
    // This prevents partial replacements (e.g., if one password contains another)
    credentialsToScrub.sort((a, b) => b.value.length - a.value.length);

    // Replace each credential value with a placeholder
    for (const { name, value } of credentialsToScrub) {
      // Only scrub non-trivial values (at least 4 chars to avoid false positives)
      if (value.length >= 4) {
        // Use a global replace that handles special regex characters
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), `[CREDENTIAL:${name}]`);
      }
    }

    return result;
  }

  /**
   * Get all credential values for scrubbing (internal use only)
   * Returns a map of value -> name for efficient lookup
   */
  async getValuesForScrubbing(): Promise<Map<string, string>> {
    await this.ensureLoaded();

    const valueToName = new Map<string, string>();

    // Add env var credentials
    const envPrefix = 'MCPROXY_CREDENTIAL_';
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(envPrefix) && value && value.length >= 4) {
        const name = key.slice(envPrefix.length).toLowerCase().replace(/_/g, '-');
        valueToName.set(value, name);
      }
    }

    // Add file credentials
    for (const [name, value] of this.fileCredentials) {
      if (value.length >= 4) {
        valueToName.set(value, name);
      }
    }

    return valueToName;
  }
}

// Singleton instance
let defaultStore: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (!defaultStore) {
    defaultStore = new CredentialStore();
  }
  return defaultStore;
}
