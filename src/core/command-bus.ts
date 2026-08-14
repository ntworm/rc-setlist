import { EventEmitter } from 'node:events';
import type { SetlistManager } from './setlist-manager.js';
import type { EventLogger } from './event-log.js';
import type {
  CommandFailureReason,
  CommandStatus,
  ShowCommand,
} from '../types.js';

type CommandCompletion = 'local' | 'observable';

export interface CommandPolicy {
  readonly completion: CommandCompletion;
  readonly critical?: true;
  readonly safetyLane?: true;
  readonly timeoutMs: number;
}

const DEFAULT_LOCAL_POLICY: CommandPolicy = Object.freeze({
  completion: 'local',
  timeoutMs: 2_000,
});

export const COMMAND_POLICIES: Readonly<Record<string, CommandPolicy>> = Object.freeze({
  play: Object.freeze({ completion: 'observable', critical: true, timeoutMs: 5_000 }),
  stop: Object.freeze({ completion: 'observable', safetyLane: true, timeoutMs: 5_000 }),
  jump: Object.freeze({ completion: 'observable', critical: true, timeoutMs: 5_000 }),
  metronome: Object.freeze({ completion: 'observable', timeoutMs: 3_000 }),
  set_pre_roll: DEFAULT_LOCAL_POLICY,
  set_quantization: Object.freeze({ completion: 'observable', timeoutMs: 3_000 }),
  refresh: DEFAULT_LOCAL_POLICY,
  reorder: Object.freeze({ completion: 'local', timeoutMs: 5_000 }),
  save_lyrics: Object.freeze({ completion: 'local', timeoutMs: 5_000 }),
  click_preview: Object.freeze({ completion: 'local', timeoutMs: 5_000 }),
  export_csv: Object.freeze({ completion: 'local', timeoutMs: 5_000 }),
  create_test_session: Object.freeze({ completion: 'local', timeoutMs: 30_000 }),
  set_panic: Object.freeze({ completion: 'local', safetyLane: true, timeoutMs: 5_000 }),
  set_critical_lock: DEFAULT_LOCAL_POLICY,
  set_mode: DEFAULT_LOCAL_POLICY,
  profiles_get: DEFAULT_LOCAL_POLICY,
  preflight_check: DEFAULT_LOCAL_POLICY,
  profile_create: Object.freeze({ completion: 'local', timeoutMs: 10_000 }),
  profile_select: Object.freeze({ completion: 'local', timeoutMs: 10_000 }),
  profile_rename: Object.freeze({ completion: 'local', timeoutMs: 10_000 }),
  profile_delete: Object.freeze({ completion: 'local', timeoutMs: 10_000 }),
  profile_restore: Object.freeze({ completion: 'local', timeoutMs: 10_000 }),
  edit_locator: Object.freeze({ completion: 'local', timeoutMs: 5_000 }),
});

type QueuedCommand = {
  command: ShowCommand<unknown>;
  executeFn: () => void | Promise<void>;
};

type CommandRetentionPhase = 'registered' | 'queued' | 'in_flight' | 'settled';

type CommandRetention = {
  command: ShowCommand<unknown>;
  phase: CommandRetentionPhase;
  timestamp: number;
};

const COMMAND_RETENTION_MS = 60_000;

function policyFor(type: string): CommandPolicy {
  return COMMAND_POLICIES[type] ?? DEFAULT_LOCAL_POLICY;
}

function isTerminal(status: CommandStatus): boolean {
  return status === 'confirmed'
    || status === 'failed'
    || status === 'expired'
    || status === 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CommandBus extends EventEmitter {
  private readonly processedIds = new Map<string, CommandRetention>();
  private readonly commandHistory = new Map<string, ShowCommand<unknown>>();
  private pendingCommands: ShowCommand<unknown>[] = [];
  private readonly commandQueue: QueuedCommand[] = [];
  private isProcessingQueue = false;
  private readonly maxQueueSize = 100;
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
    for (const [id, retention] of this.processedIds) {
      const command = this.commandHistory.get(id);
      if (command !== retention.command) continue;

      const canExpire = retention.phase === 'registered'
        || (retention.phase === 'settled' && isTerminal(command.status));
      if (!canExpire || now - retention.timestamp <= COMMAND_RETENTION_MS) continue;

      this.processedIds.delete(id);
      this.commandHistory.delete(id);
    }
  }

  private updateRetentionPhase(
    command: ShowCommand<unknown>,
    phase: CommandRetentionPhase,
  ): void {
    const retention = this.processedIds.get(command.commandId);
    if (!retention || retention.command !== command) return;
    retention.phase = phase;
    retention.timestamp = Date.now();
  }

  private markExecutionSettled(command: ShowCommand<unknown>): void {
    const retention = this.processedIds.get(command.commandId);
    if (!retention || retention.command !== command || retention.phase === 'settled') return;
    retention.phase = 'settled';
    retention.timestamp = Date.now();
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
      retryCount: 0,
      maxRetries: 0,
      timeoutMs: policyFor(type).timeoutMs,
    };

    this.processedIds.set(commandId, {
      command,
      phase: 'registered',
      timestamp: command.createdAt,
    });
    this.commandHistory.set(commandId, command);
    this.logger.log({
      type: 'command_created',
      clientId: sourceClientId,
      commandId,
      message: `Command ${type} created`,
    });
    return command;
  }

  public getQueueLength(): number {
    return this.commandQueue.length;
  }

  public dispatch<TPayload>(
    command: ShowCommand<TPayload>,
    executeFn: () => void | Promise<void>,
  ): void {
    const policy = policyFor(command.type);
    const safetyFailure = this.safetyFailureReason(command, policy);

    if (safetyFailure) {
      this.updateCommandStatus(command, 'failed', safetyFailure);
      return;
    }

    if (!policy.safetyLane && this.commandQueue.length >= this.maxQueueSize) {
      this.updateCommandStatus(command, 'failed', 'execution_failed');
      throw new Error('Command queue capacity exceeded');
    }

    this.updateRetentionPhase(command, 'queued');
    command.status = 'sent';
    this.pendingCommands.push(command);
    this.updatePendingCommandsInManager();
    this.logger.log({
      type: 'command_dispatched',
      clientId: command.sourceClientId,
      commandId: command.commandId,
      message: `Command ${command.type} dispatched`,
    });

    const item: QueuedCommand = { command, executeFn };
    if (policy.safetyLane) {
      void this.execute(item);
      return;
    }

    this.commandQueue.push(item);
    void this.processQueue();
  }

  private async execute(item: QueuedCommand): Promise<void> {
    const { command, executeFn } = item;
    if (isTerminal(command.status)) {
      this.markExecutionSettled(command);
      return;
    }

    const policy = policyFor(command.type);
    const safetyFailure = this.safetyFailureReason(command, policy);
    if (safetyFailure) {
      this.updateCommandStatus(command, 'failed', safetyFailure);
      return;
    }

    this.updateRetentionPhase(command, 'in_flight');

    try {
      await executeFn();
      if (policy.completion === 'local') {
        this.updateCommandStatus(command, 'confirmed');
      } else {
        this.resolveObservableConfirmations();
      }
    } catch {
      this.updateCommandStatus(command, 'failed', 'execution_failed');
    } finally {
      this.markExecutionSettled(command);
    }
  }

  private safetyFailureReason(
    command: ShowCommand<unknown>,
    policy: CommandPolicy,
  ): CommandFailureReason | undefined {
    if (policy.safetyLane) return undefined;

    const state = this.manager.getState();
    if (state.safety.panicActive) return 'panic_active';
    if (state.safety.criticalCommandsLocked && policy.critical) {
      return 'critical_commands_locked';
    }
    return undefined;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.commandQueue.length > 0) {
        const item = this.commandQueue[0];
        if (!item) break;
        await this.execute(item);
        this.commandQueue.shift();
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
    if (!command) return;
    this.updateCommandStatus(command, status, reason);
  }

  private updateCommandStatus(
    command: ShowCommand<unknown>,
    status: CommandStatus,
    reason?: CommandFailureReason,
  ): void {
    if (this.commandHistory.get(command.commandId) !== command) {
      this.removePendingCommand(command);
      return;
    }
    if (isTerminal(command.status)) return;

    command.status = status;
    if (reason) command.reason = reason;
    this.logger.log({
      type: `command_${status}`,
      clientId: command.sourceClientId,
      commandId: command.commandId,
      result: status,
      message: `Command ${command.type} status: ${status}${reason ? ` (${reason})` : ''}`,
    });

    if (isTerminal(status)) {
      this.removePendingCommand(command);
      const retention = this.processedIds.get(command.commandId);
      if (retention?.command === command && retention.phase !== 'in_flight') {
        this.markExecutionSettled(command);
      }
      this.emit('command_settled', command);
    }
  }

  private removePendingCommand(command: ShowCommand<unknown>): void {
    const nextPending = this.pendingCommands.filter((pending) => pending !== command);
    if (nextPending.length === this.pendingCommands.length) return;
    this.pendingCommands = nextPending;
    this.updatePendingCommandsInManager();
  }

  private updatePendingCommandsInManager(): void {
    this.manager.setPendingCommands(this.pendingCommands.map((command) => command.commandId));
  }

  private checkTimeouts(): void {
    const now = Date.now();
    for (const command of [...this.pendingCommands]) {
      if (now - command.createdAt > command.timeoutMs) {
        this.updateCommandStatus(command, 'expired', 'timeout');
      }
    }
  }

  public getPending(): ShowCommand<unknown>[] {
    return [...this.pendingCommands];
  }

  public resolveObservableConfirmations(): void {
    const state = this.manager.getState();
    const confirmed: ShowCommand<unknown>[] = [];

    for (const command of this.pendingCommands) {
      const payload = isRecord(command.payload) ? command.payload : {};
      let matches = false;

      if (command.type === 'play') {
        matches = state.isPlaying;
      } else if (command.type === 'stop') {
        matches = !state.isPlaying;
      } else if (command.type === 'metronome') {
        matches = typeof payload.value === 'boolean' && state.metronome === payload.value;
      } else if (command.type === 'set_quantization') {
        matches = typeof payload.value === 'number' && state.clipTriggerQuantization === payload.value;
      } else if (command.type === 'jump') {
        matches = payload.songIndex !== undefined
          && state.activeSongIndex === payload.songIndex
          && (payload.sectionIndex === undefined
            || payload.sectionIndex === null
            || state.activeSectionIndex === payload.sectionIndex);
      }

      if (matches) confirmed.push(command);
    }

    for (const command of confirmed) {
      this.updateCommandStatus(command, 'confirmed');
    }
  }
}
