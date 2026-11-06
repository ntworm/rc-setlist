/**
 * The entry of the panel: what the extension is doing, the three sections
 * and the way the operator moves between them.
 *
 * The page is one picture of the extension. It is not a live feed: the
 * state it shows is the state the extension had when it opened the panel,
 * and the refresh button asks for a new reading.
 */
(function () {
  'use strict';

  const Panel = window.RcPanel;
  const shell = Panel.shell;
  const el = shell.el;

  const TABS = [
    { key: 'main', button: 'tabMain', pane: 'panelMain' },
    { key: 'setlist', button: 'tabSetlist', pane: 'panelSetlist' },
    { key: 'network', button: 'tabNetwork', pane: 'panelNetwork' },
  ];

  const OSC_STATES = {
    stopped: 'panel.oscStopped',
    'port-conflict': 'panel.oscPortConflict',
    'no-reply': 'panel.oscNoReply',
    responding: 'panel.oscResponding',
    stale: 'panel.oscStale',
  };

  /**
   * The dictionary the whole project shares.
   */
  function shared() {
    return window.RcSetlistI18n;
  }

  /**
   * A word of the shared dictionary.
   */
  function translate(key, params) {
    const library = shared();
    if (library && typeof library.t === 'function') return library.t(key, params || {});
    return key;
  }

  /**
   * Whether the server is running.
   */
  function running() {
    return Boolean(window.INITIAL_IS_RUNNING);
  }

  /**
   * The dot and the words of the server.
   */
  function renderServerWords(isRunning) {
    const statusDot = el('statusDot');
    const statusText = el('statusText');
    if (statusDot) statusDot.className = `status-dot ${isRunning ? 'active' : ''}`;
    if (statusText) {
      statusText.className = `status-text ${isRunning ? 'active' : 'inactive'}`;
      statusText.textContent = translate(isRunning ? 'panel.serverRunning' : 'panel.serverStopped');
    }
  }

  /**
   * The buttons that run the server.
   */
  function renderServerButtons(isRunning) {
    const start = el('btnStart');
    const stop = el('btnStop');
    const restart = el('btnRestart');
    const diagnose = el('btnDiagnoseOsc');
    if (start) start.disabled = isRunning;
    if (stop) stop.disabled = !isRunning;
    if (restart) restart.disabled = !isRunning;
    if (diagnose) diagnose.disabled = !isRunning;
  }

  /**
   * The server, its port and the buttons that run it.
   */
  function renderStatus() {
    const isRunning = running();
    const port = window.INITIAL_PORT || 4444;
    const tls = window.INITIAL_TLS !== false;
    const infoPort = el('infoPort');
    renderServerWords(isRunning);
    if (infoPort) {
      const shown = isRunning ? `${port} (${tls ? 'HTTPS' : 'HTTP'})` : '—';
      infoPort.textContent = translate('panel.port', { port: shown });
    }
    renderServerButtons(isRunning);
  }

  /**
   * The class of the dot of the OSC side.
   */
  function oscStateClass(state) {
    const responding = state === 'responding';
    const warning = ['port-conflict', 'no-reply', 'stale'].includes(state);
    return responding ? 'active' : warning ? 'warning' : 'neutral';
  }

  /**
   * The dot and the words of the OSC side.
   */
  function renderOscState(diagnostics, stateClass) {
    const dot = el('oscStatusDot');
    const text = el('oscStatusText');
    if (dot) dot.className = `status-dot ${stateClass}`;
    if (text) {
      text.className = `status-text ${stateClass}`;
      text.textContent = translate(OSC_STATES[diagnostics.state] || 'panel.oscNoReply');
    }
  }

  /**
   * The bridge that answered, and the way to reach it.
   */
  function renderOscBridge(diagnostics) {
    const bridge = el('oscBridgeText');
    if (!bridge) return;
    const via = diagnostics.bridge
      ? translate('panel.oscVia', {
          name:
            diagnostics.bridge === 'rcbridge'
              ? diagnostics.bridgeVersion || 'RC Bridge'
              : 'AbletonOSC',
          port: String(diagnostics.targetPort || ''),
        })
      : '';
    bridge.textContent = via;
    bridge.hidden = !via;
  }

  /**
   * The state of the OSC side, and the bridge that answered.
   */
  function renderOscStatus() {
    const diagnostics = window.INITIAL_OSC_DIAGNOSTICS || { state: 'stopped' };
    const stateClass = oscStateClass(diagnostics.state);
    renderOscState(diagnostics, stateClass);
    renderOscBridge(diagnostics);
  }

  /**
   * The extension cannot look into Live's User Library, so the only truth
   * about the RC Bridge is whether it answered when the server started.
   */
  function renderBridge() {
    const hint = el('bridgeHint');
    const diagnostics = window.INITIAL_OSC_DIAGNOSTICS || {};
    if (!hint) return;
    if (!running() || !diagnostics.bridge) {
      hint.textContent = '';
      hint.hidden = true;
      return;
    }
    if (diagnostics.bridge === 'rcbridge') {
      hint.textContent = translate('panel.bridgeInUse');
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.textContent = translate('panel.bridgeMissing');
  }

  /**
   * The notices the panel owes the operator.
   */
  function renderNotices() {
    const confidence = window.INITIAL_DURATION_CONFIDENCE || 'estimated';
    const row = el('durationConfidenceRow');
    if (row) row.hidden = confidence !== 'estimated';
    const migration = el('migrationPrompt');
    if (migration) migration.hidden = Boolean(window.INITIAL_STORAGE_INITIALIZED);
  }

  /**
   * The two settings that belong to the jump.
   */
  function renderToggles() {
    const autoStart = el('btnToggleAutoStart');
    const writeTempo = el('btnToggleWriteTempo');
    const autoStartOn = Boolean(window.INITIAL_AUTO_START);
    const writeTempoOn = Boolean(window.INITIAL_WRITE_TEMPO_ON_JUMP);
    if (autoStart) {
      autoStart.textContent = translate(autoStartOn ? 'panel.on' : 'panel.off');
      autoStart.classList.toggle('is-on', autoStartOn);
    }
    if (writeTempo) {
      writeTempo.textContent = translate(writeTempoOn ? 'panel.on' : 'panel.off');
      writeTempo.classList.toggle('is-on', writeTempoOn);
    }
  }

  /**
   * What the last action of the operator did, said once.
   */
  function renderNotice() {
    const notice = window.INITIAL_NOTICE;
    const bar = el('panelNotice');
    if (!bar) return;
    if (!notice || !notice.key) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.className = `panel-notice ${notice.tone === 'error' ? 'is-error' : 'is-ok'}`;
    bar.textContent = shell.text(notice.key, notice.params || {});
  }

  /**
   * The two buttons of the language, the one in use pressed.
   */
  function renderLanguage() {
    document.querySelectorAll('.lang-btn').forEach((button) => {
      const pressed = button.getAttribute('data-locale') === shell.state.locale;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  /**
   * Shows one section and hides the others.
   */
  function selectTab(key, focus) {
    shell.state.tab = key;
    for (const tab of TABS) {
      const active = tab.key === key;
      const button = el(tab.button);
      const pane = el(tab.pane);
      if (button) {
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
      }
      if (pane) pane.hidden = !active;
    }
    if (key === 'network') Panel.network.render();
    if (key === 'setlist') Panel.project.render();
  }

  /**
   * Moves between the sections with the keyboard.
   */
  function onTabKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.key === shell.state.tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    selectTab(TABS[next].key, true);
  }

  /**
   * Asks the extension to pair a second computer.
   */
  function sendPeerPair() {
    const hostField = el('peerHostInput');
    const codeField = el('peerCodeInput');
    const host = hostField ? hostField.value.trim() : '';
    const code = codeField ? codeField.value.trim() : '';
    // An empty field would only close the panel to say it is empty.
    const missing = !host ? hostField : !code ? codeField : null;
    if (missing) {
      missing.focus();
      return;
    }
    shell.sendAction(`peer-pair:${host}:${code}`);
  }

  /**
   * Wires the buttons of the panel.
   */
  function bindActions() {
    document.querySelectorAll('[data-rc-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-rc-action');
        if (!action) return;
        if (action === 'peer-pair') {
          sendPeerPair();
          return;
        }
        shell.sendAction(action);
      });
    });
  }

  /**
   * Wires the sections of the panel.
   */
  function bindTabs() {
    for (const tab of TABS) {
      const button = el(tab.button);
      if (!button) continue;
      button.addEventListener('click', () => selectTab(tab.key, false));
      button.addEventListener('keydown', onTabKeydown);
    }
  }

  /**
   * Writes the words of the panel into the page.
   */
  function renderAll() {
    shell.applyLabels(document);
    renderStatus();
    renderOscStatus();
    renderBridge();
    renderNotices();
    renderToggles();
    renderNotice();
    renderLanguage();
    Panel.main.render();
    Panel.project.render();
    Panel.network.render();
  }

  /**
   * Sets the language of the page and follows it.
   */
  function setupLanguage() {
    const library = shared();
    let current = window.INITIAL_LOCALE || 'en';
    if (!library) return;
    library.setLocale(current);
    document.querySelectorAll('.lang-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const locale = button.getAttribute('data-locale');
        if (locale) library.setLocale(locale);
      });
    });
    library.subscribe((locale) => {
      shell.state.locale = locale;
      renderAll();
      if (locale === current) return;
      current = locale;
      shell.sendAction(`set-language:${locale}`);
    });
  }

  /**
   * Opens the panel.
   */
  function start() {
    const network = window.INITIAL_NETWORK || {};
    shell.state.locale = window.INITIAL_LOCALE || 'en';
    const tab = window.INITIAL_PANEL_TAB;
    shell.state.tab = tab === 'setlist' || tab === 'network' ? tab : 'main';
    shell.state.access = window.INITIAL_PANEL_ACCESS || 'stage';
    shell.state.address = network.selectedAddress || '';
    setupLanguage();
    bindActions();
    bindTabs();
    Panel.project.bind();
    Panel.network.bind();
    selectTab(shell.state.tab, false);
    renderAll();
  }

  start();
})();
