let installed = false;

export function installRuntimeSafety(): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (err) => {
    console.error(`[rc-setlist] uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
  });

  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? reason.stack : String(reason);
    console.error(`[rc-setlist] unhandledRejection: ${detail}`);
  });
}
