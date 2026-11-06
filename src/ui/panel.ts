import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { embedPanelAssets } from './panel-embed.js';
import { loadPanelAssets } from './panel-assets.js';
import type { ExtensionContext } from '../context.js';
import {
  startServer,
  stopServer,
  isServerRunning,
  isServerTls,
  getAuthToken,
  getOscDiagnostics,
  requestOscDiagnosticProbe,
} from '../index.js';
import { bridgeState, profileStatePayload } from '../runtime/bridge-state.js';
import { resolveLanSnapshot } from '../server/lan-address.js';
import { certCoversRequiredAltNames, hasLocalCa, httpsOptions } from '../server/cert.js';
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
import { peerPanelModel, runPeerAction, sanitizePanelAction } from './peer-panel.js';
import {
  applyEnvelopeToSession,
  createPanelSession,
  decodePanelEnvelope,
  resolveSessionAddress,
  type PanelEnvelope,
  type PanelSession,
} from './panel-session.js';
import {
  buildNetworkPanelModel,
  buildPanelModel,
  panelJson,
  PANEL_CA_PORT,
  PANEL_PORT,
  type PanelModel,
  type PanelNetworkCandidate,
} from './panel-model.js';
import { isSetlistAction, readPackagesModel, runSetlistAction } from './panel-setlists.js';
import { log } from '../util/log.js';
// __dirname is a global in CommonJS, which is our target format

type ModalContext = ExtensionContext;

/** The sentences the panel shows when something goes wrong. */
type PanelTextKey = 'actionFailed' | 'assetsFailed';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function panelText(
  key: PanelTextKey,
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
 *
 * Every action closes the window and opens it again: the bound only stops
 * a page that answers by itself forever, not an operator at work.
 */
export async function showPanelDialog(context: ModalContext): Promise<void> {
  const session = createPanelSession();
  for (let turn = 0; turn < 500; turn++) {
    let raw: string;
    try {
      raw = await renderPanelDialog(context, session);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error('panel', 'panel dialog error', { error: detail });
      return;
    }
    if (!raw) return; // The window closed without an answer: the panel is done.
    const envelope = decodePanelEnvelope(raw);
    if (!envelope) {
      // An answer that cannot be read is discarded. Nothing of it reaches the log: it may carry a code, and a code is not a log line.
      log.info('panel', 'panel answer discarded', { reason: 'not-an-envelope' });
      continue;
    }
    applyEnvelopeToSession(session, envelope);
    session.notice = null;
    logPanelAction(envelope);
    if (envelope.action === 'close' || !envelope.action) return;
    if (envelope.action.startsWith('set-language:')) {
      setUiLocale(envelope.action.slice('set-language:'.length));
      continue;
    }
    const running = isServerRunning();
    try {
      if (envelope.action === 'start' && !running) {
        log.info('lifecycle', 'starting server');
        await startServer();
      } else if (envelope.action === 'stop' && running) {
        log.info('lifecycle', 'stopping server');
        await stopServer();
      } else if (envelope.action === 'restart') {
        log.info('lifecycle', 'restarting server');
        await stopServer();
        await startServer();
      } else if (envelope.action === 'toggle-auto-start') {
        toggleAutoStart();
      } else if (envelope.action === 'toggle-write-tempo') {
        toggleWriteTempo();
      } else if (envelope.action === 'diagnose-osc' && running) {
        requestOscDiagnosticProbe();
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
      } else if (isSetlistAction(envelope.action)) {
        session.notice = await runSetlistAction(envelope);
      } else if (envelope.action.startsWith('peer-')) {
        const outcome = await runPeerAction(envelope.action, getUiLocale());
        if (!outcome.ok && outcome.message) await showInfoDialog(context, outcome.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reportPanelFailure(context, envelope, msg);
    }
  }
}

/**
 * The action the panel asked for, in the log.
 */
function logPanelAction(envelope: PanelEnvelope): void {
  log.info('panel', 'renderPanelDialog returned action', {
    action: sanitizePanelAction(envelope.action),
  });
}

/**
 * Turns the automatic start of the server around.
 */
function toggleAutoStart(): void {
  const next = !getAutoStart();
  const ok = setAutoStart(next);
  log.info('panel', 'auto-start toggled', { next, writeOk: ok });
}

/**
 * Turns the writing of the tempo of the jump around.
 */
function toggleWriteTempo(): void {
  const next = !getWriteTempoOnJump();
  const ok = setWriteTempoOnJump(next);
  bridgeState.writeTempoOnJump = next;
  log.info('panel', 'write-tempo-on-jump toggled', { next, writeOk: ok });
}

/**
 * Says that the action of the panel did not work.
 */
async function reportPanelFailure(
  context: ModalContext,
  envelope: PanelEnvelope,
  msg: string,
): Promise<void> {
  const displayAction = sanitizePanelAction(envelope.action);
  log.error('panel', 'panel action failed', { action: displayAction, error: msg });
  await showInfoDialog(context, panelText('actionFailed', { action: displayAction, detail: msg }));
}

/**
 * The address where the phone installs the authority of this computer.
 *
 * The extension serves it over plain HTTP on the port next to the server:
 * a phone that has to trust a certificate cannot be asked to trust the page
 * that carries it. The address is empty when the server is not running,
 * when it does not speak TLS or when there is no authority of its own:
 * there is nothing to install then.
 */
function localCaUrl(running: boolean, primaryIp: string, port: number): string {
  if (!running || !isServerTls() || !hasLocalCa()) return '';
  return `http://${primaryIp}:${port + 1}/ca`;
}

/**
 * The certificate of this computer, as the text it can be read in.
 */
function certificatePem(): string | null {
  return httpsOptions ? httpsOptions.cert.toString('utf8') : null;
}

/**
 * Whether the certificate of this computer covers an address.
 *
 * The certificate is never reissued for this: the panel only says which
 * of the addresses of the machine the certificate already covers.
 */
function certificateCover(): (ip: string) => boolean {
  const pem = certificatePem();
  if (!pem) return () => false;
  return (ip: string) => {
    try {
      return certCoversRequiredAltNames(pem, [ip]);
    } catch {
      return false;
    }
  };
}

/**
 * Whether the data folder of the extension holds a project already.
 */
function storageInitialized(): boolean {
  const profileManager = bridgeState.profileManager;
  if (!profileManager) return false;
  try {
    return profileManager.list().length > 0;
  } catch {
    return false;
  }
}

/**
 * The state the panel opens with, as the page reads it.
 */
function buildInjection(model: PanelModel, certUrl: string): string {
  return `
      <script>
        window.INITIAL_PORT = ${model.port};
        window.INITIAL_IS_RUNNING = ${model.running};
        window.INITIAL_TLS = ${model.tls};
        window.INITIAL_PRIMARY_IP = ${panelJson(model.network.announcedIp)};
        window.INITIAL_AUTO_START = ${model.autoStart};
        window.INITIAL_WRITE_TEMPO_ON_JUMP = ${model.writeTempoOnJump};
        window.INITIAL_TOKEN = ${panelJson(model.token)};
        window.INITIAL_LOCALE = ${panelJson(model.locale)};
        window.INITIAL_OSC_DIAGNOSTICS = ${panelJson(model.osc)};
        window.INITIAL_DURATION_CONFIDENCE = ${panelJson(model.durationConfidence)};
        window.INITIAL_STORAGE_INITIALIZED = ${model.storageInitialized ? 'true' : 'false'};
        window.INITIAL_PEER = ${panelJson(model.peer)};
        window.INITIAL_CERT_URL = ${panelJson(certUrl)};
        window.INITIAL_NETWORK = ${panelJson(model.network)};
        window.INITIAL_PROJECT = ${panelJson(model.project)};
        window.INITIAL_PLAYBACK = ${panelJson(model.playback)};
        window.INITIAL_PANEL_TAB = ${panelJson(model.tab)};
        window.INITIAL_PANEL_ACCESS = ${panelJson(model.access)};
        window.INITIAL_PACKAGES = ${panelJson(model.packages)};
        window.INITIAL_NOTICE = ${panelJson(model.notice)};
      </script>
    `;
}

/**
 * The addresses of the machine, with the certificate that covers them.
 */
function readNetworkCandidates(
  candidates: Awaited<ReturnType<typeof resolveLanSnapshot>>['candidates'],
  covers: (ip: string) => boolean,
): PanelNetworkCandidate[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    ip: candidate.ip,
    kind: candidate.kind,
    interfaceName: candidate.interfaceName,
    subnet: candidate.subnet,
    gateway: candidate.gateway,
    defaultRoute: candidate.defaultRoute,
    covered: covers(candidate.ip),
  }));
}

/**
 * The page of the panel, with the state of the extension in it.
 */
async function readPanelHtml(
  model: PanelModel,
  isRunning: boolean,
  announcedIp: string,
): Promise<string> {
  const panelDir = path.join(__dirname, 'static/panel');
  // eslint-disable-next-line no-useless-assignment -- initial value used by the catch branch when fs.readFile fails.
  let html = '';
  try {
    html = await fs.readFile(path.join(panelDir, 'index.html'), 'utf8');
    const assets = await loadPanelAssets({
      panelDir,
      sharedDir: path.join(__dirname, 'static/shared'),
      fontsDir: path.join(__dirname, 'static/fonts'),
    });

    html = embedPanelAssets(html, assets);
    // A function replacement: names of songs and setlists may hold "$&".
    const injection = buildInjection(model, localCaUrl(isRunning, announcedIp, PANEL_PORT));
    html = html.replace('<body>', () => `<body>${injection}`);
  } catch (err) {
    log.error('panel', 'Error loading panel assets', {
      error: err instanceof Error ? err.message : String(err),
    });
    const message = escapeHtml(panelText('assetsFailed', { detail: String(err) }));
    html = `<!DOCTYPE html><html lang="${getUiLocale()}"><body style="background:#1c1c1e;color:#fff;padding:20px;font-family:sans-serif"><h3>${message}</h3></body></html>`;
  }
  return html;
}

async function renderPanelDialog(context: ModalContext, session: PanelSession): Promise<string> {
  const isRunning = isServerRunning();
  const tls = isServerTls();
  const snapshot = await resolveLanSnapshot();
  const selectedAddress = resolveSessionAddress(
    session,
    snapshot.candidates.map((candidate) => candidate.ip),
  );
  const announcedIp = selectedAddress || snapshot.primaryIp;
  const network = buildNetworkPanelModel({
    candidates: readNetworkCandidates(snapshot.candidates, certificateCover()),
    primaryIp: snapshot.primaryIp,
    selectedAddress,
    protocol: tls ? 'https' : 'http',
    port: PANEL_PORT,
    caPort: PANEL_CA_PORT,
    caAvailable: isRunning && tls && hasLocalCa(),
    tls,
  });
  const oscDiagnostics = buildOscDiagnosticModel({
    serverRunning: isRunning,
    snapshot: getOscDiagnostics(),
  });
  const peerModel = peerPanelModel({ locale: getUiLocale(), localIp: announcedIp });
  const model = buildPanelModel({
    state: bridgeState,
    profilePayload: profileStatePayload,
    osc: oscDiagnostics,
    peer: peerModel,
    network,
    running: isRunning,
    port: PANEL_PORT,
    tls,
    locale: getUiLocale(),
    autoStart: getAutoStart(),
    writeTempoOnJump: getWriteTempoOnJump(),
    storageInitialized: storageInitialized(),
    token: getAuthToken(),
    tab: session.tab,
    access: session.access,
    packages: await readPackagesModel(),
    notice: session.notice,
  });
  const html = await readPanelHtml(model, isRunning, announcedIp);
  return await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 880, 780);
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
