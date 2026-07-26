import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function stop(message) {
  console.error(`[ableton-deps] ${message}`);
  console.error('[ableton-deps] ABLETON_SDK_TGZ and ABLETON_CLI_TGZ must be existing absolute local paths.');
  process.exit(2);
}

const sdkArchive = process.env.ABLETON_SDK_TGZ?.trim();
const cliArchive = process.env.ABLETON_CLI_TGZ?.trim();

if (!sdkArchive || !cliArchive) stop('Both authorized archive paths are required.');
for (const archive of [sdkArchive, cliArchive]) {
  if (!path.isAbsolute(archive) || !existsSync(archive)) {
    stop('Use existing absolute local paths outside the repository.');
  }
}

const npmExecPath = process.env.npm_execpath;
const npmArguments = [
  'install', '--no-save', '--package-lock=false', '--ignore-scripts', sdkArchive, cliArchive,
];
const result = spawnSync(npmExecPath ? process.execPath : 'npm', npmExecPath ? [npmExecPath, ...npmArguments] : npmArguments, {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'inherit',
  shell: !npmExecPath && process.platform === 'win32',
});

if (result.error) stop(`Could not start npm: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('[ableton-deps] Authorized SDK and CLI installed locally without changing the public lockfile.');
