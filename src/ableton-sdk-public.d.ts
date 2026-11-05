/**
 * Public-build boundary for the private Ableton Extensions SDK types.
 * Production builds resolve the authorized SDK package instead of this file.
 */
export type ActivationContext = unknown;

export interface Handle {
  readonly id: bigint;
}

export interface CuePoint {
  name: string;
  time: number;
}

export interface Song {
  tempo: number;
  cuePoints: CuePoint[];
  readonly handle: Handle;
}

export interface Application {
  song: Song;
}

export interface Environment {
  storageDirectory: string | undefined;
}

export interface Commands {
  registerCommand(commandId: string, callback: (...args: unknown[]) => void): void;
}

export type ContextMenuScope =
  | 'MidiTrack'
  | 'AudioTrack'
  | 'MidiClip'
  | 'AudioClip'
  | 'ClipSlot'
  | 'Scene';

export interface Ui {
  registerContextMenuAction(
    scope: ContextMenuScope,
    title: string,
    commandId: string,
  ): Promise<() => Promise<void>>;
  showModalDialog(url: string, width: number, height: number): Promise<string>;
}

export interface ExtensionContext {
  application: Application;
  commands: Commands;
  environment: Environment;
  ui: Ui;
}

export declare function initialize(
  activation: ActivationContext,
  apiVersion: string,
): ExtensionContext;
