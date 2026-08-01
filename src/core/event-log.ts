// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Asynchronous, Rotated, Deduplicated & Redacted EventLogger for RC Setlist (Task 4.1 / ADR-004)

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface EventLogEntry {
  timestamp: string;
  type: string;
  clientId?: string;
  commandId?: string;
  stateVersion?: number;
  result?: string;
  message?: string;
  repeatCount?: number;
  [key: string]: any;
}

export interface EventLoggerOptions {
  maxSizeBytes?: number;
  maxRotationFiles?: number;
  dedupWindowMs?: number;
}

const REDACT_RE = /(?:token|secret|password|key)=(?:[^\s&"']+)/gi;
const SECRET_KEY_RE = /^(?:.*_)?(?:token|secret|password|key|auth|authorization|cred|credential)(?:_.*)?$/i;
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

  const result: Record<string, any> = {};
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

export class EventLogger {
  private globalStorageDir: string;
  private logPath: string;
  private maxSizeBytes: number;
  private maxRotationFiles: number;
  private dedupWindowMs: number;

  private queue: EventLogEntry[] = [];
  private droppedEventsCount = 0;
  private isFlushing = false;
  private flushPromise: Promise<void> | null = null;

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
  }

  public log(entry: Omit<EventLogEntry, 'timestamp'>): void {
    const now = Date.now();
    const redacted = redactObject(entry);
    const entryKey = `${redacted.type}::${redacted.result ?? ''}::${redacted.message ?? ''}`;

    if (
      this.lastEntryKey === entryKey &&
      now - this.lastEntryTime < this.dedupWindowMs
    ) {
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
      type: redacted.type,
      timestamp: new Date(now).toISOString(),
      ...redacted,
    };

    this.queue.push(fullEntry);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.isFlushing) return;
    this.isFlushing = true;
    this.flushPromise = Promise.resolve().then(() => this.processQueue());
  }

  private async processQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) break;

        const line = JSON.stringify(item) + '\n';
        const lineBytes = Buffer.byteLength(line, 'utf8');

        let currentSize = 0;
        try {
          const stat = fs.statSync(this.logPath);
          currentSize = stat.size;
        } catch {
          // File does not exist yet
        }

        if (currentSize + lineBytes > this.maxSizeBytes) {
          this.rotateFiles();
        }

        await fs.promises.appendFile(this.logPath, line, 'utf8');
      }
    } catch (err) {
      console.error('[EventLogger] Failed to write log batch:', err);
    } finally {
      this.isFlushing = false;
    }
  }

  private rotateFiles(): void {
    try {
      const oldestFile = path.join(
        this.globalStorageDir,
        `events.log.${this.maxRotationFiles}`
      );
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
    } catch (err) {
      console.error('[EventLogger] Log rotation failed:', err);
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
    await this.processQueue();
    if (this.flushPromise) {
      await this.flushPromise;
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }
}
