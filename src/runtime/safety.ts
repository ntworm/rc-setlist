import { log } from '../util/log.js';

let installed = false;

/**
 * InstallRuntimeSafety — implementation detail.
 */
export function installRuntimeSafety(): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (err) => {
    const detail = err && err.stack ? err.stack : String(err);
    log.error('lifecycle', 'uncaughtException', { detail });
  });

  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? reason.stack : String(reason);
    log.error('lifecycle', 'unhandledRejection', { detail });
  });
}
