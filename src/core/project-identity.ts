import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';

export interface ProjectMetadata {
  song_name?: unknown;
  file_path?: unknown;
  is_dirty?: unknown;
}

export type ProjectIdentitySource = 'mcp-path' | 'window-title' | 'session';

export interface ProjectIdentity {
  key: string;
  displayName: string;
  filePath: string | null;
  source: ProjectIdentitySource;
  persistent: boolean;
  legacyProjectKey: string | null;
}

interface IdentityOptions {
  platform?: NodeJS.Platform;
}

interface ResolveProjectIdentityOptions extends IdentityOptions {
  sessionId?: string;
  getProjectMetadata?: () => Promise<ProjectMetadata | null>;
  readWindowTitle?: () => Promise<string>;
}

/**
 * ProjectSessionIdForSong — implementation detail.
 */
export function projectSessionIdForSong(
  processId: number,
  songHandleId: string,
  fallbackSessionId: string,
): string {
  const handle = cleanDisplayName(songHandleId);
  if (!handle) return fallbackSessionId;
  return `extension-host:${processId}:song:${handle}`;
}

function cleanDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return (
    value
      .normalize('NFKC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')
      .trim()
      .slice(0, 160)
  );
}

function pathApiFor(filePath: string, platform: NodeJS.Platform): typeof path.win32 {
  return platform === 'win32' || /^[A-Za-z]:[\\/]/u.test(filePath) ? path.win32 : path.posix;
}

function canonicalProjectPath(filePath: string, platform: NodeJS.Platform): string | null {
  const cleaned = cleanDisplayName(filePath);
  if (!cleaned || !/\.als$/iu.test(cleaned)) return null;
  const api = pathApiFor(cleaned, platform);
  const normalized = api.normalize(cleaned).replace(/\\/gu, '/');
  return platform === 'win32' || /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLocaleLowerCase('en-US')
    : normalized;
}

function hashKey(namespace: string, value: string): string {
  return createHash('sha256').update(`${namespace}:${value}`).digest('hex').slice(0, 32);
}

/**
 * LegacyProjectKeyForFile — implementation detail.
 */
export function legacyProjectKeyForFile(filePath: string): string | null {
  const cleaned = cleanDisplayName(filePath);
  if (!cleaned) return null;
  const api = pathApiFor(cleaned, /^[A-Za-z]:[\\/]/u.test(cleaned) ? 'win32' : process.platform);
  const projectDirectory = api.dirname(cleaned).replace(/\\/gu, '/');
  if (!projectDirectory || projectDirectory === '.') return null;
  return createHash('md5').update(projectDirectory).digest('hex');
}

/**
 * ProjectIdentityFromMetadata — implementation detail.
 */
export function projectIdentityFromMetadata(
  metadata: ProjectMetadata | null | undefined,
  options: IdentityOptions = {},
): ProjectIdentity | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const platform = options.platform ?? process.platform;
  const rawFilePath = cleanDisplayName(metadata.file_path);
  const canonicalPath = canonicalProjectPath(rawFilePath, platform);
  if (!canonicalPath) return null;

  const api = pathApiFor(rawFilePath, platform);
  const fallbackName = api.basename(rawFilePath, api.extname(rawFilePath));
  const displayName = cleanDisplayName(metadata.song_name) || fallbackName || 'Current Live Set';
  return {
    key: hashKey('path', canonicalPath),
    displayName,
    filePath: rawFilePath,
    source: 'mcp-path',
    persistent: true,
    legacyProjectKey: legacyProjectKeyForFile(rawFilePath),
  };
}

/**
 * ProjectIdentityFromWindowTitle — implementation detail.
 */
export function projectIdentityFromWindowTitle(title: string): ProjectIdentity | null {
  const cleaned = cleanDisplayName(title)
    .replace(/\s+-\s+Ableton Live(?:\s+.*)?$/iu, '')
    .replace(/\*$/u, '')
    .trim();
  if (!cleaned || /^untitled$/iu.test(cleaned)) return null;
  return {
    key: hashKey('title', cleaned.toLocaleLowerCase('und')),
    displayName: cleaned,
    filePath: null,
    source: 'window-title',
    persistent: true,
    legacyProjectKey: null,
  };
}

/**
 * The AppleScript that names the main window of Live on macOS.
 *
 * System Events reads it only once Live (or the app that runs this server)
 * holds the Accessibility permission; until then the script fails and the
 * Set falls back to a session of its own. The main window is asked for by
 * AXMain, so a plugin window or the panel of an extension in front of it is
 * never taken for the Set.
 */
export const MAC_WINDOW_TITLE_SCRIPT = [
  'tell application "System Events"',
  '  set liveProcs to (application processes whose name is "Live" or name starts with "Ableton Live")',
  '  if (count of liveProcs) is 0 then return ""',
  '  set liveProc to item 1 of liveProcs',
  '  try',
  '    return name of (first window of liveProc whose value of attribute "AXMain" is true)',
  '  on error',
  '    if (count of windows of liveProc) is 0 then return ""',
  '    return name of window 1 of liveProc',
  '  end try',
  'end tell',
].join('\n');

/** The command that reads the title of Live's window on this system. */
export function windowTitleCommand(
  platform: NodeJS.Platform,
): { file: string; args: string[] } | null {
  if (platform === 'win32') {
    const command = [
      "$process = Get-Process | Where-Object { $_.ProcessName -like 'Ableton Live*' -and $_.MainWindowTitle } | Select-Object -First 1",
      'if ($process) { $process.MainWindowTitle }',
    ].join('; ');
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  if (platform === 'darwin') return { file: 'osascript', args: ['-e', MAC_WINDOW_TITLE_SCRIPT] };
  return null;
}

/**
 * Reads the ableton window title.
 */
export function readAbletonWindowTitle(
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const command = windowTitleCommand(platform);
  if (!command) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile(
      command.file,
      command.args,
      { encoding: 'utf8', timeout: 2_000, windowsHide: true },
      (error, stdout) => resolve(error ? '' : stdout.trim()),
    );
  });
}

/**
 * Resolves the project identity.
 */
export async function resolveProjectIdentity(
  options: ResolveProjectIdentityOptions = {},
): Promise<ProjectIdentity> {
  const platform = options.platform ?? process.platform;
  let metadata: ProjectMetadata | null = null;
  try {
    metadata = (await options.getProjectMetadata?.()) ?? null;
  } catch {
    // swallow: nothing to do here on purpose
  }

  const metadataIdentity = projectIdentityFromMetadata(metadata, { platform });
  if (metadataIdentity) return metadataIdentity;

  try {
    const title = await (options.readWindowTitle ?? readAbletonWindowTitle)();
    const titleIdentity = projectIdentityFromWindowTitle(title);
    if (titleIdentity) return titleIdentity;
  } catch {
    // swallow: nothing to do here on purpose
  }

  const sessionId = cleanDisplayName(options.sessionId) || randomUUID();
  const metadataName = cleanDisplayName(metadata?.song_name);
  return {
    key: hashKey('session', sessionId),
    displayName: metadataName || 'Current Live Set',
    filePath: null,
    source: 'session',
    persistent: false,
    legacyProjectKey: null,
  };
}
