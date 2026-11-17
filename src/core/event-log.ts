// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Asynchronous, Rotated, Deduplicated & Redacted EventLogger for RC Setlist (Task 4.1 / ADR-004)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../util/log.js';

export interface EventLogEntry {
  timestamp: string;
  type: string;
  clientId?: string;
  commandId?: string;
  stateVersion?: number;
  result?: string;
  message?: string;
  repeatCount?: number;
  [key: string]: unknown;
}

/**
 * File functions the logger writes through; tests replace them.
 *
 * `rotate` reports success with `true`; `false` or a thrown error means the
 * file was not rotated and the logger keeps counting its size.
 */
export interface EventLogFileOps {
  appendFile(filePath: string, data: string): Promise<void>;
  stat(filePath: string): Promise<{ size: number }>;
  rotate(): boolean;
}

export interface EventLoggerOptions {
  maxSizeBytes?: number;
  maxRotationFiles?: number;
  dedupWindowMs?: number;
  fileOps?: Partial<EventLogFileOps>;
}

const REDACT_RE = /(?:token|secret|password|key)=(?:[^\s&"']+)/gi;
const SECRET_KEY_RE =
  /^(?:.*_)?(?:token|secret|password|key|auth|authorization|cred|credential)(?:_.*)?$/i;
const MAX_QUEUE_SIZE = 2048;

function redactString(val: string): string {
  return val.replace(REDACT_RE, (match) => {
    const eqIdx = match.indexOf('=');
    if (eqIdx !== -1) {
      return `${match.slice(0, eqIdx + 1)}[REDACTED]`;
    }
    return '[REDACTED]';
  });
}

function redactObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  if (typeof obj === 'string') return redactString(obj) as unknown as T;

  if (Array.isArray(obj)) {
    return obj.map(redactObject) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      result[k] = redactString(v);
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactObject(v);
    } else {
      result[k] = v;
    }
  }
  return result as T;
}

/**
 * Manages the lifecycle and public surface of EventLogger.
 */
export class EventLogger {
  private globalStorageDir: string;
  private logPath: string;
  private maxSizeBytes: number;
  private maxRotationFiles: number;
  private dedupWindowMs: number;

  private queue: EventLogEntry[] = [];
  private droppedEventsCount = 0;
  private flushPromise: Promise<void> | null = null;
  private readonly fileOps: EventLogFileOps;
  private currentSize: number | null = null;

  private lastEntryKey: string | null = null;
  private lastEntryTime = 0;
  private lastRepeatCount = 0;

  constructor(globalStorageDir: string, options: EventLoggerOptions = {}) {
    this.globalStorageDir = globalStorageDir;
    this.maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxRotationFiles = options.maxRotationFiles ?? 3;
    this.dedupWindowMs = options.dedupWindowMs ?? 500;

    if (!fs.existsSync(globalStorageDir)) {
      fs.mkdirSync(globalStorageDir, { recursive: true });
    }
    this.logPath = path.join(globalStorageDir, 'events.log');
    this.fileOps = {
      appendFile: (filePath, data) => fs.promises.appendFile(filePath, data, 'utf8'),
      stat: (filePath) => fs.promises.stat(filePath),
      rotate: () => this.rotateFiles(),
      ...options.fileOps,
    };
  }

  public log(entry: Omit<EventLogEntry, 'timestamp'>): void {
    const now = Date.now();
    const redacted = redactObject(entry);
    const rType = typeof redacted.type === 'string' ? redacted.type : 'unknown';
    const rResult = typeof redacted.result === 'string' ? redacted.result : '';
    const rMessage = typeof redacted.message === 'string' ? redacted.message : '';
    const entryKey = `${rType}::${rResult}::${rMessage}`;

    if (this.lastEntryKey === entryKey && now - this.lastEntryTime < this.dedupWindowMs) {
      this.lastRepeatCount++;
      return;
    }

    if (this.lastRepeatCount > 0 && this.queue.length > 0) {
      const prev = this.queue[this.queue.length - 1];
      if (prev) {
        prev.repeatCount = this.lastRepeatCount + 1;
      }
      this.lastRepeatCount = 0;
    }

    this.lastEntryKey = entryKey;
    this.lastEntryTime = now;

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.droppedEventsCount++;
      this.queue.shift(); // Drop oldest to keep queue bounded
    }

    const fullEntry: EventLogEntry = {
      type: typeof redacted.type === 'string' ? redacted.type : 'unknown',
      timestamp: new Date(now).toISOString(),
      ...redacted,
    };

    this.queue.push(fullEntry);
    void this.scheduleFlush();
  }

  /** Starts a flush unless one is in flight; that one picks up new entries. */
  private scheduleFlush(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = Promise.resolve().then(() => this.processQueue());
    }
    return this.flushPromise;
  }

  private async processQueue(): Promise<void> {
    try {
      if (this.currentSize === null) {
        try {
          this.currentSize = (await this.fileOps.stat(this.logPath)).size;
        } catch {
          this.currentSize = 0; // File does not exist yet
        }
      }
      while (this.queue.length > 0) {
        await this.writeBatch(this.queue.splice(0));
      }
    } catch (err) {
      log.error('core', 'Failed to write log batch', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.flushPromise = null;
    }
  }

  /** Writes one appendFile per chunk, rotating where a chunk would pass the limit. */
  private async writeBatch(batch: EventLogEntry[]): Promise<void> {
    let chunk = '';
    let chunkBytes = 0;
    for (const item of batch) {
      const line = JSON.stringify(item) + '\n';
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if ((this.currentSize ?? 0) + chunkBytes + lineBytes > this.maxSizeBytes) {
        if (chunk) {
          await this.appendChunk(chunk, chunkBytes);
          chunk = '';
          chunkBytes = 0;
        }
        if (this.tryRotate()) this.currentSize = 0;
      }
      chunk += line;
      chunkBytes += lineBytes;
    }
    if (chunk) await this.appendChunk(chunk, chunkBytes);
  }

  private async appendChunk(chunk: string, chunkBytes: number): Promise<void> {
    await this.fileOps.appendFile(this.logPath, chunk);
    this.currentSize = (this.currentSize ?? 0) + chunkBytes;
  }

  private tryRotate(): boolean {
    try {
      return this.fileOps.rotate();
    } catch (err) {
      log.error('core', 'Log rotation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private rotateFiles(): boolean {
    try {
      const oldestFile = path.join(this.globalStorageDir, `events.log.${this.maxRotationFiles}`);
      if (fs.existsSync(oldestFile)) {
        fs.unlinkSync(oldestFile);
      }

      for (let i = this.maxRotationFiles - 1; i >= 1; i--) {
        const src = path.join(this.globalStorageDir, `events.log.${i}`);
        const dest = path.join(this.globalStorageDir, `events.log.${i + 1}`);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
        }
      }

      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, path.join(this.globalStorageDir, 'events.log.1'));
      }
      return true;
    } catch (err) {
      log.error('core', 'Log rotation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  public async flush(): Promise<void> {
    if (this.lastRepeatCount > 0 && this.queue.length > 0) {
      const prev = this.queue[this.queue.length - 1];
      if (prev) {
        prev.repeatCount = this.lastRepeatCount + 1;
      }
      this.lastRepeatCount = 0;
    }
    // A caller during a flush awaits the flush in flight; a later one may
    // have started for entries logged meanwhile.
    while (this.queue.length > 0 || this.flushPromise) {
      await this.scheduleFlush();
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }
}
