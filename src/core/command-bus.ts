import { EventEmitter } from 'node:events';
import { SetlistManager } from './setlist-manager.js';
import { EventLogger } from './event-log.js';
import { ShowCommand, CommandStatus } from '../types.js';
import { OSCClient } from '../integration/osc-client.js';

export interface CommandPolicy {
  maxRetries: number;
  timeoutMs: number;
  isIdempotent: boolean;
  canRetry: boolean;
}

export class CommandBus extends EventEmitter {
  private processedIds: Map<string, number> = new Map(); // commandId -> timestamp
  private commandHistory: Map<string, ShowCommand> = new Map();
  private pendingCommands: ShowCommand[] = [];
  private commandQueue: Array<{ command: ShowCommand; executeFn: () => void | Promise<void> }> = [];
  private isProcessingQueue = false;
  private manager: SetlistManager;
  private oscClient: OSCClient | null;
  private logger: EventLogger;
  private timeoutInterval: NodeJS.Timeout | null = null;

  constructor(manager: SetlistManager, oscClient: OSCClient | null, logger: EventLogger) {
    super();
    this.manager = manager;
    this.oscClient = oscClient;
    this.logger = logger;
    this.startTimeoutTimer();
  }

  private startTimeoutTimer(): void {
    if (this.timeoutInterval) return;
    this.timeoutInterval = setInterval(() => {
      this.checkTimeouts();
      this.cleanProcessedIds();
    }, 200);
  }

  public stop(): void {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }
  }

  private cleanProcessedIds(): void {
    const now = Date.now();
    for (const [id, time] of this.processedIds.entries()) {
      if (now - time > 60000) { // Keep processed IDs for 60 seconds
        this.processedIds.delete(id);
      }
    }
    for (const [id, cmd] of this.commandHistory.entries()) {
      const isTerminal = cmd.status === 'confirmed' || cmd.status === 'failed' || cmd.status === 'expired' || cmd.status === 'cancelled';
      if (isTerminal && now - cmd.createdAt > 60000) {
        this.commandHistory.delete(id);
      }
    }
  }

  private getPolicy(type: string): CommandPolicy {
    switch (type) {
      case 'play':
      case 'stop':
        return { maxRetries: 0, timeoutMs: 5000, isIdempotent: true, canRetry: false };
      case 'toggle_play':
      case 'next_cue':
      case 'prev_cue':
      case 'jump':
        return { maxRetries: 0, timeoutMs: 5000, isIdempotent: false, canRetry: false };
      case 'set_metronome':
      case 'toggle_metronome':
      case 'set_quantization':
        return { maxRetries: 3, timeoutMs: 3000, isIdempotent: true, canRetry: true };
      default:
        // Local/instant commands
        return { maxRetries: 0, timeoutMs: 2000, isIdempotent: true, canRetry: false };
    }
  }

  public isDuplicate(commandId: string): boolean {
    return this.processedIds.has(commandId);
  }

  public registerCommand(
    commandId: string,
    type: string,
    payload: any,
    sourceClientId: string
  ): ShowCommand {
    const policy = this.getPolicy(type);
    const command: ShowCommand = {
      commandId,
      type,
      payload,
      sourceClientId,
      createdAt: Date.now(),
      status: 'created',
      retryCount: 0,
      maxRetries: policy.maxRetries,
      timeoutMs: policy.timeoutMs,
    };

    this.processedIds.set(commandId, Date.now());
    this.commandHistory.set(commandId, command);
    this.logger.log({
      type: 'command_created',
      clientId: sourceClientId,
      commandId,
      message: `Command ${type} created`,
    });

    return command;
  }

  public dispatch(command: ShowCommand, executeFn: () => void | Promise<void>): void {
    if (this.manager.getState().safety.panicActive) {
      this.updateStatus(command.commandId, 'failed', 'Rejected: Panic mode is active.');
      return;
    }

    if (this.manager.getState().safety.criticalCommandsLocked && this.isCritical(command.type)) {
      this.updateStatus(command.commandId, 'failed', 'Rejected: Critical commands are locked.');
      return;
    }

    command.status = 'sent';
    this.pendingCommands.push(command);
    this.updatePendingCommandsInManager();

    this.logger.log({
      type: 'command_dispatched',
      clientId: command.sourceClientId,
      commandId: command.commandId,
      message: `Command ${command.type} dispatched`,
    });

    this.commandQueue.push({ command, executeFn });
    this.processQueue().catch((err) => {
      console.error('[CommandBus] Error processing command queue:', err);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.commandQueue.length > 0) {
        const item = this.commandQueue[0]!;
        const { command, executeFn } = item;
        try {
          const res = executeFn();
          if (res instanceof Promise) {
            await res;
          }
          if (this.isLocal(command.type)) {
            this.updateStatus(command.commandId, 'confirmed');
          }
        } catch (err) {
          this.updateStatus(command.commandId, 'failed', String(err));
        } finally {
          this.commandQueue.shift();
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private isCritical(type: string): boolean {
    const criticalTypes = new Set(['play', 'stop', 'toggle_play', 'next_cue', 'prev_cue', 'jump']);
    return criticalTypes.has(type);
  }

  private isLocal(type: string): boolean {
    const localTypes = new Set([
      'reorder',
      'save_lyrics',
      'create_test_session',
      'profiles_get',
      'profile_create',
      'profile_select',
      'profile_rename',
      'profile_delete',
      'profile_restore',
    ]);
    return localTypes.has(type);
  }

  public updateStatus(commandId: string, status: CommandStatus, reason?: string): void {
    const cmd = this.commandHistory.get(commandId);
    if (!cmd) return;

    if (cmd.status === 'confirmed' || cmd.status === 'failed' || cmd.status === 'expired' || cmd.status === 'cancelled') {
      // Terminal state already reached
      return;
    }

    cmd.status = status;
    this.logger.log({
      type: `command_${status}`,
      clientId: cmd.sourceClientId,
      commandId,
      result: status,
      message: `Command ${cmd.type} status: ${status}${reason ? ` (${reason})` : ''}`,
    });

    if (status === 'confirmed' || status === 'failed' || status === 'expired' || status === 'cancelled') {
      this.pendingCommands = this.pendingCommands.filter((c) => c.commandId !== commandId);
      this.updatePendingCommandsInManager();
      this.emit('command_settled', cmd);
    }
  }

  private updatePendingCommandsInManager(): void {
    this.manager.setPendingCommands(this.pendingCommands.map((c) => c.commandId));
  }

  private checkTimeouts(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const cmd of this.pendingCommands) {
      if (now - cmd.createdAt > cmd.timeoutMs) {
        toRemove.push(cmd.commandId);
      }
    }

    for (const id of toRemove) {
      const cmd = this.commandHistory.get(id);
      if (cmd) {
        const policy = this.getPolicy(cmd.type);
        if (policy.canRetry && cmd.retryCount < cmd.maxRetries) {
          cmd.retryCount++;
          cmd.createdAt = Date.now(); // reset timer for retry
          this.logger.log({
            type: 'command_retry',
            clientId: cmd.sourceClientId,
            commandId: id,
            message: `Retrying command ${cmd.type} (attempt ${cmd.retryCount}/${cmd.maxRetries})`,
          });
          this.emit('retry_required', cmd);
        } else {
          this.updateStatus(id, 'expired', 'Timeout exceeded without confirmation');
        }
      }
    }
  }

  public getPending(): ShowCommand[] {
    return [...this.pendingCommands];
  }

  public resolveObservableConfirmations(): void {
    const state = this.manager.getState();
    const toConfirm: string[] = [];

    for (const cmd of this.pendingCommands) {
      let isConfirmed = false;

      if (cmd.type === 'play' && state.isPlaying) {
        isConfirmed = true;
      } else if (cmd.type === 'stop' && !state.isPlaying) {
        isConfirmed = true;
      } else if (cmd.type === 'toggle_play') {
        const target = cmd.payload?.targetIsPlaying;
        if (target !== undefined && state.isPlaying === target) {
          isConfirmed = true;
        }
      } else if (cmd.type === 'set_metronome' || cmd.type === 'toggle_metronome') {
        const target = cmd.payload?.targetValue;
        if (target !== undefined && state.metronome === target) {
          isConfirmed = true;
        }
      } else if (cmd.type === 'set_quantization') {
        const target = cmd.payload?.value;
        if (target !== undefined && state.clipTriggerQuantization === target) {
          isConfirmed = true;
        }
      } else if (cmd.type === 'jump') {
        // Jump is confirmed when the manager's active song/section matches the target
        const targetSongIdx = cmd.payload?.songIndex;
        const targetSecIdx = cmd.payload?.sectionIndex;
        if (targetSongIdx !== undefined) {
          if (state.activeSongIndex === targetSongIdx) {
            if (targetSecIdx === undefined || targetSecIdx === null || state.activeSectionIndex === targetSecIdx) {
              isConfirmed = true;
            }
          }
        }
      } else if (cmd.type === 'next_cue' || cmd.type === 'prev_cue') {
        // Confirmed when active index moves to expected target
        const expectedSongIdx = cmd.payload?.expectedSongIndex;
        const expectedSecIdx = cmd.payload?.expectedSectionIndex;
        if (expectedSongIdx !== undefined) {
          if (state.activeSongIndex === expectedSongIdx) {
            if (expectedSecIdx === undefined || expectedSecIdx === null || state.activeSectionIndex === expectedSecIdx) {
              isConfirmed = true;
            }
          }
        }
      }

      if (isConfirmed) {
        toConfirm.push(cmd.commandId);
      }
    }

    for (const id of toConfirm) {
      this.updateStatus(id, 'confirmed');
    }
  }
}
