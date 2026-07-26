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
}

export class EventLogger {
  private logPath: string;

  constructor(globalStorageDir: string) {
    if (!fs.existsSync(globalStorageDir)) {
      fs.mkdirSync(globalStorageDir, { recursive: true });
    }
    this.logPath = path.join(globalStorageDir, 'events.log');
  }

  public log(entry: Omit<EventLogEntry, 'timestamp'>): void {
    const fullEntry: EventLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    try {
      fs.appendFileSync(this.logPath, `${JSON.stringify(fullEntry)}\n`, 'utf8');
    } catch (err) {
      console.error('[EventLogger] Failed to write event log:', err);
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }
}
