import { initialize, type ActivationContext } from '@ableton-extensions/sdk';
import { setExtensionContext, clearExtensionContext } from './context.js';
import { installRuntimeSafety } from './runtime/safety.js';
import { registerPanelCommand } from './ui/panel.js';
import { startServer, stopServer } from './index.js';
import { getAutoStart } from './preferences.js';

let activated = false;

function activate(activation: ActivationContext): void {
  if (activated) {
    console.log('[rc-setlist] activate() called while already active; restarting server only');
    startServer().catch((err) => {
      console.error(`[rc-setlist] restart startServer failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    return;
  }
  activated = true;

  installRuntimeSafety();

  const context = initialize(activation, '1.0.0');
  setExtensionContext(context);

  registerPanelCommand(context);

  // Auto-start is now opt-in via the panel toggle, persisted in .setlist/auto-start.
  // When the toggle is OFF, the server stays dormant and never binds OSC/WS ports —
  // this is what lets RC Surface and Setlist coexist in the same Live session.
  if (getAutoStart()) {
    console.log('[rc-setlist] auto-start enabled; starting server');
    startServer().catch((err) => {
      console.error(`[rc-setlist] initial startServer failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } else {
    console.log('[rc-setlist] auto-start disabled; server stays stopped until manually started from the panel');
  }

  console.log('[rc-setlist] activate() done; awaiting requests');
}

function deactivate(): void {
  if (!activated) return;
  activated = false;

  stopServer()
    .catch((err) => {
      console.error(`[rc-setlist] stopServer failed: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      clearExtensionContext();
      console.log('[rc-setlist] deactivate() done; awaiting next activate');
    });
}

export { activate, deactivate };
