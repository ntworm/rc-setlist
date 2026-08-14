import type { McpTcpClient, ProjectMetadata, SessionInfo } from './mcp-client.js';

interface McpCaller {
  call(type: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface McpFallbackSyncOptions {
  client: McpCaller | McpTcpClient;
  onSessionInfo: (info: SessionInfo) => void | Promise<void>;
  onSongLength: (length: number) => void | Promise<void>;
  getProjectMetadataRequestToken: () => string | null;
  onProjectMetadata?: (metadata: ProjectMetadata, requestToken: string) => void | Promise<void>;
  now?: () => number;
  slowPollIntervalMs?: number;
  metadataPollIntervalMs?: number;
  retryIntervalMs?: number;
}

export interface McpFallbackSnapshot {
  inFlight: boolean;
  lastResponseTime: number;
  timeSinceLastResponseMs: number | null;
  lastSessionInfoTime: number;
  timeSinceLastSessionInfoMs: number | null;
}

export class McpFallbackSync {
  private readonly client: McpCaller;
  private readonly onSessionInfo: McpFallbackSyncOptions['onSessionInfo'];
  private readonly onSongLength: McpFallbackSyncOptions['onSongLength'];
  private readonly getProjectMetadataRequestToken: McpFallbackSyncOptions['getProjectMetadataRequestToken'];
  private readonly onProjectMetadata?: McpFallbackSyncOptions['onProjectMetadata'];
  private readonly now: () => number;
  private readonly slowPollIntervalMs: number;
  private readonly metadataPollIntervalMs: number;
  private readonly retryIntervalMs: number;
  private inFlight = false;
  private nextAttemptTime = Number.NEGATIVE_INFINITY;
  private lastResponseTime = 0;
  private lastSessionInfoTime = 0;
  private lastSlowPollTime = Number.NEGATIVE_INFINITY;
  private lastMetadataPollTime = Number.NEGATIVE_INFINITY;

  constructor(options: McpFallbackSyncOptions) {
    this.client = options.client;
    this.onSessionInfo = options.onSessionInfo;
    this.onSongLength = options.onSongLength;
    this.getProjectMetadataRequestToken = options.getProjectMetadataRequestToken;
    this.onProjectMetadata = options.onProjectMetadata;
    this.now = options.now ?? Date.now;
    this.slowPollIntervalMs = options.slowPollIntervalMs ?? 2_000;
    this.metadataPollIntervalMs = options.metadataPollIntervalMs ?? 2_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 1_000;
  }

  private markResponse(): void {
    this.lastResponseTime = this.now();
  }

  public getSnapshot(): McpFallbackSnapshot {
    const current = this.now();
    return {
      inFlight: this.inFlight,
      lastResponseTime: this.lastResponseTime,
      timeSinceLastResponseMs: this.lastResponseTime > 0
        ? Math.max(0, current - this.lastResponseTime)
        : null,
      lastSessionInfoTime: this.lastSessionInfoTime,
      timeSinceLastSessionInfoMs: this.lastSessionInfoTime > 0
        ? Math.max(0, current - this.lastSessionInfoTime)
        : null,
    };
  }

  public async tick(): Promise<boolean> {
    if (this.inFlight || this.now() < this.nextAttemptTime) return false;
    this.inFlight = true;
    try {
      const info = await this.client.call('get_session_info') as SessionInfo;
      this.nextAttemptTime = Number.NEGATIVE_INFINITY;
      this.markResponse();
      this.lastSessionInfoTime = this.now();
      await this.onSessionInfo(info);

      const current = this.now();
      if (current - this.lastSlowPollTime >= this.slowPollIntervalMs) {
        this.lastSlowPollTime = current;
        try {
          const result = await this.client.call('get_song_length') as { song_length?: unknown };
          this.markResponse();
          const length = result?.song_length;
          if (typeof length === 'number' && Number.isFinite(length)) {
            await this.onSongLength(length);
          }
        } catch {
          // The fast transport snapshot remains useful when an older MCP
          // bridge does not expose get_song_length.
        }
      }

      const projectMetadataRequestToken = this.getProjectMetadataRequestToken();
      if (
        this.onProjectMetadata
        && projectMetadataRequestToken !== null
        && current - this.lastMetadataPollTime >= this.metadataPollIntervalMs
      ) {
        this.lastMetadataPollTime = current;
        try {
          const metadata = await this.client.call('get_project_metadata') as ProjectMetadata;
          this.markResponse();
          if (metadata && typeof metadata === 'object') {
            await this.onProjectMetadata(metadata, projectMetadataRequestToken);
          }
        } catch {
          // Saved-set metadata can become available after startup; retry on
          // the next slow metadata interval without disrupting transport.
        }
      }

      return true;
    } catch (error) {
      this.nextAttemptTime = this.now() + this.retryIntervalMs;
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
}
