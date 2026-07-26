import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { initialize } from '@ableton-extensions/sdk';
import { startServer, stopServer, isServerRunning, getAuthToken } from '../index.js';
import { getLanAddresses, pickLanIps } from '../util/helpers.js';
import { getAutoStart, setAutoStart } from '../preferences.js';
// __dirname is a global in CommonJS, which is our target format

type ModalContext = ReturnType<typeof initialize>;

export async function showInfoDialog(
  context: ModalContext,
  message: string,
): Promise<void> {
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html>
<html><head><style>
*,*::before,*::after{box-sizing:border-box}*{margin:0}
:root{--bg:hsl(0,0%,21%);--text:hsl(0,0%,71%);--ctrl:hsl(0,0%,16%);--border:hsl(0,0%,7%);--accent:hsl(32,100%,55%)}
html{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;height:100%}
body{padding:1.5em;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1em}
p{text-align:center;line-height:1.5}
.actions{display:flex;justify-content:flex-end;width:100%}
.btn{font-size:1rem;background:var(--ctrl);color:var(--text);border:1px solid var(--border);height:24px;padding:0 1.5em;border-radius:1em;cursor:pointer}
.btn:active{background:var(--accent);color:hsl(0,0%,7%)}
</style></head>
<body>
<p>${safe}</p>
<div class="actions">
  <button class="btn" onclick="send('ok')">OK</button>
</div>
<script>function send(v){const m={method:"close_and_send",params:[v]};if(window.webkit?.messageHandlers?.live)window.webkit.messageHandlers.live.postMessage(m);else if(window.chrome?.webview)window.chrome.webview.postMessage(m);}</script>
</body></html>`;
  await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 380, 180);
}

export async function showPanelDialog(context: ModalContext): Promise<void> {
  for (let turn = 0; turn < 24; turn++) {
    let action: string;
    try {
      action = await renderPanelDialog(context);
      console.log(`[rc-setlist] renderPanelDialog returned action: "${action}"`);
    } catch (err) {
      console.error(`[rc-setlist] panel dialog error: ${err}`);
      return;
    }
    if (action === 'close' || !action) return;
    const running = isServerRunning();
    try {
      if (action === 'start' && !running) {
        console.log('[rc-setlist] starting server...');
        await startServer();
      } else if (action === 'stop' && running) {
        console.log('[rc-setlist] stopping server...');
        await stopServer();
      } else if (action === 'restart') {
        console.log('[rc-setlist] restarting server...');
        await stopServer();
        await startServer();
      } else if (action === 'toggle-auto-start') {
        const next = !getAutoStart();
        const ok = setAutoStart(next);
        console.log(`[rc-setlist] auto-start toggled to ${next} (write ok=${ok})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rc-setlist] panel action "${action}" failed: ${msg}`);
      await showInfoDialog(context, `Erro ao executar "${action}": ${msg}`);
    }
  }
}

async function renderPanelDialog(context: ModalContext): Promise<string> {
  const isRunning = isServerRunning();
  const port = 4444;
  const lanIps = getLanAddresses();
  const { primary: primaryIp } = pickLanIps(lanIps);

  const panelDir = path.join(__dirname, 'static/panel');
  let html = '';
  try {
    html = await fs.readFile(path.join(panelDir, 'index.html'), 'utf8');
    const qrJs = await fs.readFile(path.join(panelDir, 'qrcode.js'), 'utf8');

    html = html.replace('<script src="qrcode.js"></script>', `<script>${qrJs}</script>`);

    const injection = `
      <script>
        window.INITIAL_PORT = ${port};
        window.INITIAL_IS_RUNNING = ${isRunning};
        window.INITIAL_PRIMARY_IP = "${primaryIp}";
        window.INITIAL_AUTO_START = ${getAutoStart()};
        window.INITIAL_TOKEN = "${getAuthToken()}";
      </script>
    `;
    html = html.replace('<body>', `<body>${injection}`);
  } catch (err) {
    console.error('[rc-setlist] Error loading panel assets:', err);
    html = `<!DOCTYPE html><html><body style="background:#1c1c1e;color:#fff;padding:20px;font-family:sans-serif"><h3>Failed to load panel files: ${err}</h3></body></html>`;
  }

  return await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 760, 600);
}

export function registerPanelCommand(context: ReturnType<typeof initialize>): void {
  void context.commands.registerCommand('abletonSetlistBridge.panel', async () => {
    await showPanelDialog(context);
  });
  
  const SCOPES = [
    'MidiTrack',
    'AudioTrack',
    'MidiClip',
    'AudioClip',
    'ClipSlot',
    'Scene',
  ] as const;
  for (const scope of SCOPES) {
    void context.ui.registerContextMenuAction(scope, 'Ableton RC Setlist: Painel', 'abletonSetlistBridge.panel');
  }
}
