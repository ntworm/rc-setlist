/**
 * The network tab: the addresses of this computer and the pages a phone
 * opens through them.
 *
 * Everything the tab shows comes from the extension: the addresses the
 * machine holds, the one the panel announces and whether the certificate
 * of this computer covers it. The panel never measures whether a phone can
 * reach anything - it cannot - and it never says that it did.
 *
 * Changing the address changes the announced addresses and the codes that
 * carry them. It does not touch the certificate: the certificate of this
 * computer is what it is.
 */
(function () {
  'use strict';

  const Panel = window.RcPanel;
  const shell = Panel.shell;
  const el = shell.el;

  let certQrDrawn = false;

  /**
   * The addresses of the machine, as the extension reported them.
   */
  function network() {
    return (
      window.INITIAL_NETWORK || {
        candidates: [],
        primaryIp: window.INITIAL_PRIMARY_IP || '',
        selectedAddress: '',
        announcedIp: window.INITIAL_PRIMARY_IP || '',
        protocol: window.INITIAL_TLS === false ? 'http' : 'https',
        port: window.INITIAL_PORT || 4444,
        caPort: (window.INITIAL_PORT || 4444) + 1,
        caAvailable: false,
        certCoversSelected: false,
        tls: window.INITIAL_TLS !== false,
      }
    );
  }

  /**
   * Whether the server is running.
   */
  function running() {
    return Boolean(window.INITIAL_IS_RUNNING);
  }

  /**
   * The address the panel announces.
   */
  function announcedHost() {
    const model = network();
    return model.announcedIp || model.primaryIp || '127.0.0.1';
  }

  /**
   * The pages the phone opens, with the address the panel announces.
   */
  function pageUrls() {
    const model = network();
    const scheme = model.protocol === 'https' ? 'https' : 'http';
    const host = announcedHost();
    const port = model.port || 4444;
    const token = window.INITIAL_TOKEN || '';
    return {
      stage: `${scheme}://${host}:${port}/setlist?token=${token}`,
      performance: `${scheme}://${host}:${port}/performance`,
    };
  }

  /**
   * The address the phone installs the certificate from.
   *
   * The page of the authority lives on the port next to the server: a
   * phone that has to trust a certificate cannot be asked to trust the
   * page that carries it.
   */
  function certificateUrl() {
    if (!window.INITIAL_CERT_URL) return '';
    const model = network();
    return `http://${announcedHost()}:${model.caPort || model.port + 1}/ca`;
  }

  /**
   * Draws a code, replacing the one that was there.
   */
  function drawQr(frameId, value, size) {
    const frame = el(frameId);
    if (!frame) {
      return;
    }
    frame.textContent = '';
    if (!value) {
      return;
    }
    if (typeof window.QRCode !== 'function') {
      return;
    }
    new window.QRCode(frame, {
      text: value,
      width: size,
      height: size,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }

  /**
   * The line that describes one address.
   */
  function candidateMeta(candidate) {
    const parts = [candidate.kind, candidate.interfaceName];
    if (candidate.subnet) parts.push(candidate.subnet);
    if (candidate.gateway) parts.push(`${shell.text('network.gateway')} ${candidate.gateway}`);
    if (candidate.defaultRoute) parts.push(shell.text('network.defaultRoute'));
    return parts.filter(Boolean).join(' · ');
  }

  /**
   * The list of the addresses the machine holds.
   */
  function renderCandidates() {
    const list = el('networkCandidates');
    if (!list) return;
    list.textContent = '';
    const model = network();
    if (!model.candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'setting-hint';
      empty.textContent = shell.text('network.candidatesEmpty');
      list.appendChild(empty);
      return;
    }
    for (const candidate of model.candidates) {
      const selected = candidate.ip === model.announcedIp;
      const row = document.createElement('div');
      row.className = 'candidate-row';
      if (selected) row.classList.add('is-selected');
      const ip = document.createElement('span');
      ip.className = 'candidate-ip';
      ip.textContent = candidate.ip;
      const meta = document.createElement('span');
      meta.className = 'candidate-meta';
      meta.textContent = candidateMeta(candidate);
      row.appendChild(ip);
      row.appendChild(meta);
      if (selected) {
        const flag = document.createElement('span');
        flag.className = 'candidate-flag';
        flag.textContent = shell.text('network.selected');
        row.appendChild(flag);
      } else if (model.tls && !candidate.covered) {
        // An address the certificate does not cover cannot be chosen: say why.
        const flag = document.createElement('span');
        flag.className = 'candidate-flag is-muted';
        flag.textContent = shell.text('network.notCoveredShort');
        row.appendChild(flag);
      }
      list.appendChild(row);
    }
  }

  /**
   * The choice of the address, automatic first.
   */
  function renderAddressSelect() {
    const select = el('networkAddressSelect');
    if (!select) return;
    const model = network();
    select.textContent = '';
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = shell.text('network.automatic');
    select.appendChild(automatic);
    for (const candidate of model.candidates) {
      const option = document.createElement('option');
      option.value = candidate.ip;
      option.textContent = `${candidate.ip} — ${candidate.interfaceName}`;
      if (model.tls && !candidate.covered) option.disabled = true;
      select.appendChild(option);
    }
    select.value = model.selectedAddress || '';
  }

  /**
   * Whether the certificate of this computer covers the address.
   */
  function renderCoverage(model) {
    const coverage = el('networkCoverage');
    if (coverage) {
      if (!model.caAvailable) coverage.textContent = shell.text('network.caNotReadyShort');
      else if (model.certCoversSelected) coverage.textContent = shell.text('network.coveredShort');
      else coverage.textContent = shell.text('network.notCoveredShort');
    }
    const coverageHint = el('networkCoverageHint');
    if (coverageHint) {
      const uncovered = model.caAvailable && !model.certCoversSelected;
      coverageHint.hidden = !uncovered;
      if (uncovered) coverageHint.textContent = shell.text('network.notCovered');
    }
  }

  /**
   * The subnet of the address the panel announces, and the help of the network.
   */
  function renderNetworkHints(model) {
    const subnetHint = el('networkSubnetHint');
    const lanHint = el('networkLanHint');
    const selected = model.candidates.find((candidate) => candidate.ip === model.announcedIp);
    if (subnetHint) {
      const subnet = selected && selected.subnet ? selected.subnet : '';
      subnetHint.textContent = subnet ? shell.text('network.sameSubnet', { subnet: subnet }) : '';
    }
    if (lanHint) lanHint.textContent = shell.text('network.lanHelp');
  }

  /**
   * The address, the protocol, the port and the certificate.
   */
  function renderSummary() {
    const model = network();
    const primary = el('networkPrimaryIp');
    const protocol = el('networkProtocol');
    const port = el('networkPort');
    const caPort = el('networkCaPort');
    if (primary) primary.textContent = model.announcedIp || '—';
    if (protocol) protocol.textContent = String(model.protocol || 'http').toUpperCase();
    if (port) port.textContent = String(model.port || 4444);
    if (caPort) caPort.textContent = String(model.caPort || 4445);
    renderCoverage(model);
    renderNetworkHints(model);
  }

  /**
   * The addresses of the two pages a phone opens.
   */
  function renderAccessUrls(urls) {
    const urlSetlist = el('urlSetlist');
    const urlStage = el('urlStage');
    if (urlSetlist) urlSetlist.textContent = urls.stage;
    if (urlStage) urlStage.textContent = urls.performance;
    shell.setLinkEnabled(el('openSetlist'), running(), urls.stage);
    shell.setLinkEnabled(el('openStage'), running(), urls.performance);
  }

  /**
   * The one code on show, and the button that swaps it for the other page.
   */
  function renderAccessPanels() {
    const stageVisible = shell.state.access !== 'performance';
    const pairs = [
      ['panelStageControl', 'panelPerformanceDisplay'],
      ['urlSetlist', 'urlStage'],
      ['openSetlist', 'openStage'],
      ['btnCopySetlist', 'btnCopyStage'],
    ];
    for (const [stageId, performanceId] of pairs) {
      if (el(stageId)) el(stageId).hidden = !stageVisible;
      if (el(performanceId)) el(performanceId).hidden = stageVisible;
    }
    const stageName = shell.text('panel.stageControl');
    const performanceName = shell.text('panel.performanceDisplay');
    const label = el('accessLabel');
    if (label) label.textContent = stageVisible ? stageName : performanceName;
    const swapText = el('accessSwapText');
    if (swapText) swapText.textContent = stageVisible ? performanceName : stageName;
    return stageVisible;
  }

  /**
   * The codes of the two pages.
   */
  function renderAccessCodes(urls, stageVisible) {
    const grid = el('qrGrid');
    const placeholder = el('placeholderText');
    if (grid) grid.hidden = !running();
    // Without a server there is no page to pick between, nor a link to give.
    for (const id of ['btnAccessSwap', 'accessActions']) {
      if (el(id)) el(id).hidden = !running();
    }
    for (const id of ['urlSetlist', 'urlStage']) {
      if (el(id) && !running()) el(id).hidden = true;
    }
    if (placeholder) placeholder.hidden = running();
    if (!running()) return;
    // The code is drawn in the page that is open: a code that is drawn
    // where nobody can see it has no size to be scanned with.
    if (stageVisible) drawQr('qrSetlist', urls.stage, 138);
    else drawQr('qrStage', urls.performance, 138);
  }

  /**
   * The two pages a phone opens, with their codes.
   */
  function renderAccess() {
    const urls = pageUrls();
    renderAccessUrls(urls);
    const stageVisible = renderAccessPanels();
    renderAccessCodes(urls, stageVisible);
  }

  /**
   * The certificate of this computer and its page.
   */
  function renderCertificate() {
    const card = el('phoneCertCard');
    const url = certificateUrl();
    if (card) card.hidden = !url;
    const urlText = el('certUrl');
    if (urlText) urlText.textContent = url;
    if (certQrDrawn && url) drawQr('qrCert', url, 72);
  }

  /**
   * The words and the host of the second computer.
   */
  function renderPeerStatus(peer) {
    const statusText = el('peerStatusText');
    const localAddress = el('peerLocalAddress');
    const hostInput = el('peerHostInput');
    if (statusText) statusText.textContent = peer.statusText || '';
    if (localAddress) {
      localAddress.textContent = `${peer.localIp || '127.0.0.1'}:${peer.port || 4444}`;
    }
    if (hostInput && !hostInput.value) hostInput.value = peer.host || '';
  }

  /**
   * The code of the second computer and the buttons of its card.
   */
  function renderPeerCode(peer) {
    const activeCode = el('peerActiveCode');
    const codeHint = el('peerCodeHint');
    const codeButton = el('btnPeerCode');
    const unpairButton = el('btnPeerUnpair');
    if (activeCode) activeCode.textContent = peer.code || '';
    if (codeHint) codeHint.textContent = peer.codeHint || '';
    if (codeButton) codeButton.disabled = !peer.canGenerateCode;
    if (unpairButton) unpairButton.disabled = !peer.paired;
  }

  /**
   * The second computer.
   */
  function renderPeer() {
    const peer = window.INITIAL_PEER || {};
    renderPeerStatus(peer);
    renderPeerCode(peer);
    const details = el('peerDetails');
    if (peer.code && details && details.hidden) togglePeerDetails();
  }

  /**
   * Draws the code of the certificate page.
   */
  function drawCertQr() {
    const url = certificateUrl();
    if (!url) return;
    drawQr('qrCert', url, 72);
    certQrDrawn = true;
  }

  /**
   * Opens or closes the card of the second computer.
   */
  function togglePeerDetails() {
    const details = el('peerDetails');
    const button = el('btnPeerToggle');
    const cert = el('certDetails');
    if (!details || !button) return;
    const open = details.hidden;
    if (open && cert && !cert.hidden) toggleCertDetails();
    details.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    const labelKey = open ? 'panel.peerHide' : 'panel.peerShow';
    button.setAttribute('data-i18n', labelKey);
    button.textContent = shell.text(labelKey);
  }

  /**
   * Opens or closes the card of the certificate.
   */
  function toggleCertDetails() {
    const details = el('certDetails');
    const button = el('btnCertToggle');
    const peer = el('peerDetails');
    if (!details || !button) return;
    const open = details.hidden;
    if (open && peer && !peer.hidden) togglePeerDetails();
    details.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    const labelKey = open ? 'panel.peerHide' : 'panel.peerShow';
    button.setAttribute('data-i18n', labelKey);
    button.textContent = shell.text(labelKey);
    if (open) drawCertQr();
  }

  /**
   * Copies a link, or shows it when the clipboard is not there.
   */
  async function copyLink(value, button) {
    const copied = await Panel.copy.copyText(value);
    const fallback = el('copyFallback');
    const field = el('copyFallbackValue');
    if (copied) {
      if (fallback) fallback.hidden = true;
      flashCopied(button);
      return;
    }
    if (field) field.value = value;
    if (fallback) fallback.hidden = false;
  }

  /**
   * Says that the link was copied, for a moment.
   */
  function flashCopied(button) {
    if (!button) return;
    const label = button.getAttribute('data-rc-text');
    button.textContent = shell.text('network.copied');
    window.setTimeout(() => {
      if (label) button.textContent = shell.text(label);
    }, 1500);
  }

  /**
   * Announces another address.
   */
  function applyAddress(value) {
    const model = network();
    model.selectedAddress = value;
    model.announcedIp = value || model.primaryIp;
    const chosen = model.candidates.find((candidate) => candidate.ip === model.announcedIp);
    model.certCoversSelected = chosen ? chosen.covered : false;
    shell.state.address = value;
    render();
    shell.sendAction('select-address');
  }

  /**
   * Paints the whole tab.
   */
  function render() {
    renderSummary();
    renderAddressSelect();
    renderCandidates();
    renderAccess();
    renderCertificate();
    renderPeer();
  }

  /**
   * Wires the tab to the page.
   */
  function bind() {
    const select = el('networkAddressSelect');
    if (select) {
      select.addEventListener('change', () => {
        applyAddress(select.value);
      });
    }
    const swap = el('btnAccessSwap');
    if (swap) {
      swap.addEventListener('click', () => {
        shell.state.access = shell.state.access === 'performance' ? 'stage' : 'performance';
        renderAccess();
      });
    }
    const copyStage = el('btnCopySetlist');
    if (copyStage) {
      copyStage.addEventListener('click', () => {
        copyLink(pageUrls().stage, copyStage);
      });
    }
    const copyPerformance = el('btnCopyStage');
    if (copyPerformance) {
      copyPerformance.addEventListener('click', () => {
        copyLink(pageUrls().performance, copyPerformance);
      });
    }
    const peerToggle = el('btnPeerToggle');
    if (peerToggle) peerToggle.addEventListener('click', togglePeerDetails);
    const certToggle = el('btnCertToggle');
    if (certToggle) certToggle.addEventListener('click', toggleCertDetails);
  }

  Panel.network = {
    bind: bind,
    render: render,
    renderAccess: renderAccess,
    pageUrls: pageUrls,
    togglePeerDetails: togglePeerDetails,
    toggleCertDetails: toggleCertDetails,
  };
})();
