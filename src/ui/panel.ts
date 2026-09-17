import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { embedPanelAssets } from './panel-embed.js';
import type { ExtensionContext } from '../context.js';
import {
  startServer,
  stopServer,
  isServerRunning,
  getAuthToken,
  getOscDiagnostics,
  requestOscDiagnosticProbe,
} from '../index.js';
import { bridgeState } from '../runtime/bridge-state.js';
import { getLanAddresses, pickLanIps } from '../util/helpers.js';
import {
  getAutoStart,
  getUiLocale,
  setAutoStart,
  setUiLocale,
  type UiLocale,
  getWriteTempoOnJump,
  setWriteTempoOnJump,
} from '../preferences.js';
import { buildOscDiagnosticModel } from './osc-diagnostics.js';
import { log } from '../util/log.js';
// __dirname is a global in CommonJS, which is our target format

type ModalContext = ExtensionContext;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function panelText(
  key: 'actionFailed' | 'assetsFailed',
  params: Record<string, string>,
  locale: UiLocale = getUiLocale(),
): string {
  const templates = {
    actionFailed: {
      en: 'Could not run "{action}": {detail}',
      'pt-BR': 'Não foi possível executar "{action}": {detail}',
    },
    assetsFailed: {
      en: 'Failed to load panel files: {detail}',
      'pt-BR': 'Falha ao carregar os arquivos do painel: {detail}',
    },
  } as const;
  return templates[key][locale].replace(
    /\{(\w+)\}/g,
    (match, name: string) => params[name] ?? match,
  );
}

/**
 * ShowInfoDialog — implementation detail.
 */
export async function showInfoDialog(context: ModalContext, message: string): Promise<void> {
  const safe = escapeHtml(message);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
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

/**
 * ShowPanelDialog — implementation detail.
 */
export async function showPanelDialog(context: ModalContext): Promise<void> {
  for (let turn = 0; turn < 24; turn++) {
    let action: string;
    try {
      action = await renderPanelDialog(context);
      log.info('panel', 'renderPanelDialog returned action', { action });
    } catch (err) {
      log.error('panel', 'panel dialog error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (action === 'close' || !action) return;
    if (action.startsWith('set-language:')) {
      setUiLocale(action.slice('set-language:'.length));
      continue;
    }
    const running = isServerRunning();
    try {
      if (action === 'start' && !running) {
        log.info('lifecycle', 'starting server');
        await startServer();
      } else if (action === 'stop' && running) {
        log.info('lifecycle', 'stopping server');
        await stopServer();
      } else if (action === 'restart') {
        log.info('lifecycle', 'restarting server');
        await stopServer();
        await startServer();
      } else if (action === 'toggle-auto-start') {
        const next = !getAutoStart();
        const ok = setAutoStart(next);
        log.info('panel', 'auto-start toggled', { next, writeOk: ok });
      } else if (action === 'toggle-write-tempo') {
        const next = !getWriteTempoOnJump();
        const ok = setWriteTempoOnJump(next);
        bridgeState.writeTempoOnJump = next;
        log.info('panel', 'write-tempo-on-jump toggled', { next, writeOk: ok });
      } else if (action === 'diagnose-osc' && running) {
        requestOscDiagnosticProbe();
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('panel', 'panel action failed', { action, error: msg });
      await showInfoDialog(context, panelText('actionFailed', { action, detail: msg }));
    }
  }
}

async function renderPanelDialog(context: ModalContext): Promise<string> {
  const isRunning = isServerRunning();
  const port = 4444;
  const lanIps = getLanAddresses();
  const { primary: primaryIp } = pickLanIps(lanIps);
  const oscDiagnostics = buildOscDiagnosticModel({
    serverRunning: isRunning,
    snapshot: getOscDiagnostics(),
  });

  const panelDir = path.join(__dirname, 'static/panel');
  // eslint-disable-next-line no-useless-assignment -- initial value used by the catch branch when fs.readFile fails.
  let html = '';
  try {
    html = await fs.readFile(path.join(panelDir, 'index.html'), 'utf8');
    const uiSystemCss = await fs.readFile(
      path.join(__dirname, 'static/shared/ui-system.css'),
      'utf8',
    );
    const qrJs = await fs.readFile(path.join(panelDir, 'qrcode.js'), 'utf8');
    const i18nJs = await fs.readFile(path.join(__dirname, 'static/shared/i18n.js'), 'utf8');

    html = embedPanelAssets(html, { uiSystemCss, i18nJs, qrJs });

    const durationConfidence = bridgeState.manager?.getState()?.durationConfidence ?? 'estimated';
    const storageInitialized = bridgeState.profileManager
      ? bridgeState.profileManager.list().length > 0
      : false;

    const injection = `
      <script>
        window.INITIAL_PORT = ${port};
        window.INITIAL_IS_RUNNING = ${isRunning};
        window.INITIAL_PRIMARY_IP = "${primaryIp}";
        window.INITIAL_AUTO_START = ${getAutoStart()};
        window.INITIAL_WRITE_TEMPO_ON_JUMP = ${getWriteTempoOnJump()};
        window.INITIAL_TOKEN = "${getAuthToken()}";
        window.INITIAL_LOCALE = ${JSON.stringify(getUiLocale())};
        window.INITIAL_OSC_DIAGNOSTICS = ${JSON.stringify(oscDiagnostics)};
        window.INITIAL_DURATION_CONFIDENCE = "${durationConfidence}";
        window.INITIAL_STORAGE_INITIALIZED = ${storageInitialized ? 'true' : 'false'};
      </script>
    `;
    html = html.replace('<body>', `<body>${injection}`);
  } catch (err) {
    log.error('panel', 'Error loading panel assets', {
      error: err instanceof Error ? err.message : String(err),
    });
    const message = escapeHtml(panelText('assetsFailed', { detail: String(err) }));
    html = `<!DOCTYPE html><html lang="${getUiLocale()}"><body style="background:#1c1c1e;color:#fff;padding:20px;font-family:sans-serif"><h3>${message}</h3></body></html>`;
  }

  return await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 760, 600);
}

/**
 * Registers the panel command.
 */
export function registerPanelCommand(context: ExtensionContext): void {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- registerCommand callback is documented to return Promise<void>
  void context.commands.registerCommand('abletonSetlistBridge.panel', async () => {
    await showPanelDialog(context);
  });

  const SCOPES = ['MidiTrack', 'AudioTrack', 'MidiClip', 'AudioClip', 'ClipSlot', 'Scene'] as const;
  for (const scope of SCOPES) {
    void context.ui.registerContextMenuAction(scope, 'RC Setlist', 'abletonSetlistBridge.panel');
  }
}
