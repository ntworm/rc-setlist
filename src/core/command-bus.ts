import { EventEmitter } from 'node:events';
import type { EventLogger } from './event-log.js';
import type { SetlistManager } from './setlist-manager.js';
import type { CommandFailureReason, CommandStatus, ShowCommand } from '../types.js';

type CommandCompletion = 'local' | 'observable';

export interface CommandPolicy {
  completion: CommandCompletion;
  critical?: boolean;
  safetyLane?: boolean;
  timeoutMs: number;
}

const DEFAULT_LOCAL_POLICY: CommandPolicy = Object.freeze({
  completion: 'local',
  timeoutMs: 2_000,
});

export const COMMAND_POLICIES: Readonly<Record<string, CommandPolicy>> = Object.freeze({
  play: { completion: 'observable', critical: true, timeoutMs: 5_000 },
  stop: { completion: 'observable', safetyLane: true, timeoutMs: 5_000 },
  toggle_play: { completion: 'observable', critical: true, timeoutMs: 5_000 },
  next_cue: { completion: 'observable', critical: true, timeoutMs: 5_000 },
  prev_cue: { completion: 'observable', critical: true, timeoutMs: 5_000 },
  jump: { completion: 'observable', critical: true, timeoutMs: 5_000 },
  metronome: { completion: 'observable', timeoutMs: 3_000 },
  set_quantization: { completion: 'observable', timeoutMs: 3_000 },
  refresh: DEFAULT_LOCAL_POLICY,
  reorder: { completion: 'local', timeoutMs: 5_000 },
  save_lyrics: { completion: 'local', timeoutMs: 5_000 },
  click_preview: { completion: 'local', timeoutMs: 5_000 },
  export_csv: { completion: 'local', timeoutMs: 5_000 },
  create_test_session: { completion: 'local', timeoutMs: 30_000 },
  set_panic: { completion: 'local', safetyLane: true, timeoutMs: 5_000 },
  set_critical_lock: DEFAULT_LOCAL_POLICY,
  set_mode: DEFAULT_LOCAL_POLICY,
  profiles_get: DEFAULT_LOCAL_POLICY,
  preflight_check: DEFAULT_LOCAL_POLICY,
  profile_create: { completion: 'local', timeoutMs: 10_000 },
  profile_select: { completion: 'local', timeoutMs: 10_000 },
  profile_rename: { completion: 'local', timeoutMs: 10_000 },
  profile_delete: { completion: 'local', timeoutMs: 10_000 },
  profile_restore: { completion: 'local', timeoutMs: 10_000 },
});

type QueuedCommand = {
  command: ShowCommand<unknown>;
  executeFn: () => void | Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function policyFor(type: string): CommandPolicy {
  return COMMAND_POLICIES[type] ?? DEFAULT_LOCAL_POLICY;
}

function terminal(status: CommandStatus): boolean {
  return status === 'confirmed'
    || status === 'failed'
    || status === 'expired'
    || status === 'cancelled';
}

export class CommandBus extends EventEmitter {
  private processedIds = new Map<string, number>();
  private commandHistory = new Map<string, ShowCommand<unknown>>();
  private pendingCommands: ShowCommand<unknown>[] = [];
  private commandQueue: QueuedCommand[] = [];
  private isProcessingQueue = false;
  private timeoutInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly manager: SetlistManager,
    private readonly logger: EventLogger,
  ) {
    super();
    this.startTimeoutTimer();
  }

  private startTimeoutTimer(): void {
    if (this.timeoutInterval) return;
    this.timeoutInterval = setInterval(() => {
      this.checkTimeouts();
      this.cleanHistory();
    }, 200);
  }

  public stop(): void {
    if (!this.timeoutInterval) return;
    clearInterval(this.timeoutInterval);
    this.timeoutInterval = null;
  }

  private cleanHistory(): void {
    const now = Date.now();
    for (const [id, time] of this.processedIds) {
      if (now - time > 60_000) this.processedIds.delete(id);
    }
    for (const [id, command] of this.commandHistory) {
      if (terminal(command.status) && now - command.createdAt > 60_000) {
        this.commandHistory.delete(id);
      }
    }
  }

  public isDuplicate(commandId: string): boolean {
    return this.processedIds.has(commandId);
  }

  public registerCommand<TPayload>(
    commandId: string,
    type: string,
    payload: TPayload,
    sourceClientId: string,
  ): ShowCommand<TPayload> {
    const command: ShowCommand<TPayload> = {
      commandId,
      type,
      payload,
      sourceClientId,
      createdAt: Date.now(),
      status: 'created',
      timeoutMs: policyFor(type).timeoutMs,
    };

    this.processedIds.set(commandId, command.createdAt);
    this.commandHistory.set(commandId, command);
    this.logger.log({
      type: 'command_created',
      clientId: sourceClientId,
      commandId,
      message: `Command ${type} created`,
    });
    return command;
  }

  public dispatch<TPayload>(command: ShowCommand<TPayload>, executeFn: () => void | Promise<void>): void {
    const state = this.manager.getState();
    const allowedDuringPanic = command.type === 'stop' || command.type === 'set_panic';
    if (state.safety.panicActive && !allowedDuringPanic) {
      this.updateStatus(command.commandId, 'failed', 'panic_active');
      return;
    }

    if (state.safety.criticalCommandsLocked && policyFor(command.type).critical) {
      this.updateStatus(command.commandId, 'failed', 'critical_commands_locked');
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

    const item = { command, executeFn };
    if (policyFor(command.type).safetyLane) {
      void this.execute(item);
      return;
    }

    this.commandQueue.push(item);
    void this.processQueue();
  }

  private async execute(item: QueuedCommand): Promise<void> {
    const { command, executeFn } = item;
    if (terminal(command.status)) return;
    try {
      await executeFn();
      if (policyFor(command.type).completion === 'local') {
        this.updateStatus(command.commandId, 'confirmed');
      } else {
        this.resolveObservableConfirmations();
      }
    } catch (error) {
      this.updateStatus(command.commandId, 'failed', 'execution_failed');
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    try {
      while (this.commandQueue.length > 0) {
        const item = this.commandQueue.shift();
        if (item) await this.execute(item);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  public updateStatus(
    commandId: string,
    status: CommandStatus,
    reason?: CommandFailureReason,
  ): void {
    const command = this.commandHistory.get(commandId);
    if (!command || terminal(command.status)) return;

    command.status = status;
    if (reason) command.reason = reason;
    this.logger.log({
      type: `command_${status}`,
      clientId: command.sourceClientId,
      commandId,
      result: status,
      message: `Command ${command.type} status: ${status}${reason ? ` (${reason})` : ''}`,
    });

    if (terminal(status)) {
      this.pendingCommands = this.pendingCommands.filter((pending) => pending.commandId !== commandId);
      this.updatePendingCommandsInManager();
      this.emit('command_settled', command);
    }
  }

  private updatePendingCommandsInManager(): void {
    this.manager.setPendingCommands(this.pendingCommands.map((command) => command.commandId));
  }

  private checkTimeouts(): void {
    const now = Date.now();
    for (const command of [...this.pendingCommands]) {
      if (now - command.createdAt > command.timeoutMs) {
        this.updateStatus(command.commandId, 'expired', 'timeout');
      }
    }
  }

  public getPending(): ShowCommand<unknown>[] {
    return [...this.pendingCommands];
  }

  public resolveObservableConfirmations(): void {
    const state = this.manager.getState();
    const confirmed: string[] = [];

    for (const command of this.pendingCommands) {
      const payload = isRecord(command.payload) ? command.payload : {};
      let matches = false;
      if (command.type === 'play') matches = state.isPlaying;
      else if (command.type === 'stop') matches = !state.isPlaying;
      else if (command.type === 'toggle_play') matches = typeof payload?.targetIsPlaying === 'boolean'
        && state.isPlaying === payload.targetIsPlaying;
      else if (command.type === 'metronome') matches = typeof payload?.value === 'boolean'
        && state.metronome === payload.value;
      else if (command.type === 'set_quantization') matches = typeof payload?.value === 'number'
        && state.clipTriggerQuantization === payload.value;
      else if (command.type === 'jump') matches = payload?.songIndex !== undefined
        && state.activeSongIndex === payload.songIndex
        && (payload.sectionIndex === undefined || payload.sectionIndex === null
          || state.activeSectionIndex === payload.sectionIndex);
      else if (command.type === 'next_cue' || command.type === 'prev_cue') {
        matches = payload?.expectedSongIndex !== undefined
          && state.activeSongIndex === payload.expectedSongIndex
          && (payload.expectedSectionIndex === undefined || payload.expectedSectionIndex === null
            || state.activeSectionIndex === payload.expectedSectionIndex);
      }
      if (matches) confirmed.push(command.commandId);
    }

    for (const commandId of confirmed) this.updateStatus(commandId, 'confirmed');
  }
}
