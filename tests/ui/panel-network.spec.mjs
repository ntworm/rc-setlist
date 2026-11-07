import { expect, test } from '@playwright/test';

// The panel as the extension hands it over: the server runs, the RC Bridge
// answered and the machine holds two addresses.
const LIVE_OSC_DIAGNOSTICS = {
  state: 'responding',
  listenPort: 11101,
  bridge: 'rcbridge',
  bridgeVersion: 'RC Bridge 1.2.0',
  targetPort: 11101,
};

const LIVE_NETWORK = {
  candidates: [
    {
      ip: '192.168.1.50',
      kind: 'wifi',
      interfaceName: 'Wi-Fi',
      subnet: '192.168.1.0/24',
      gateway: '192.168.1.1',
      defaultRoute: true,
      covered: true,
    },
    {
      ip: '192.168.0.10',
      kind: 'ethernet',
      interfaceName: 'Ethernet',
      subnet: '192.168.0.0/24',
      gateway: null,
      defaultRoute: false,
      covered: true,
    },
  ],
  primaryIp: '192.168.1.50',
  selectedAddress: '',
  announcedIp: '192.168.1.50',
  protocol: 'https',
  port: 4444,
  caPort: 4445,
  caAvailable: true,
  certCoversSelected: true,
  tls: true,
};

const LIVE_PROJECT = {
  projectName: 'Summer Tour',
  profiles: [
    { id: 'one', name: 'Main Setlist' },
    { id: 'two', name: 'Festival' },
  ],
  deletedProfiles: [],
  activeProfileId: 'one',
  canMutate: true,
  locked: false,
  lockReason: null,
};

const LIVE_SONGS = [
  { title: 'Alpha', durationSeconds: 210, sectionCount: 4, color: '#ff8800' },
  { title: 'Beta', durationSeconds: 305, sectionCount: 6, color: '#22aa66' },
  { title: 'Gamma', durationSeconds: 240, sectionCount: 2, color: '#3366ff' },
];

const LIVE_PLAYBACK = {
  isPlaying: false,
  songCount: LIVE_SONGS.length,
  durationSeconds: 754,
  tempo: 128,
  activeSongIndex: 0,
  songs: LIVE_SONGS,
};

const LIVE_PEER = {
  statusText: 'Not paired with a second computer',
  paired: false,
  host: '',
  port: 4444,
  localIp: '192.168.1.50',
  code: null,
  canGenerateCode: true,
  codeHint: '',
};

const LIVE_PACKAGES = {
  dir: '/Users/op/Library/Application Support/RC Setlist/packages',
  files: [{ file: 'Summer Tour.rcsetlist', modifiedAt: 1762362000000 }],
};

// The values the page reads when the panel opens.
const LIVE_FIXTURE = {
  oscDiagnostics: LIVE_OSC_DIAGNOSTICS,
  network: LIVE_NETWORK,
  packages: LIVE_PACKAGES,
  peer: LIVE_PEER,
  playback: LIVE_PLAYBACK,
  project: LIVE_PROJECT,
};

// The panel as the extension hands it over: the values above reach the
// page as they are.
const livePanelInit = (fixture) => {
  window.INITIAL_IS_RUNNING = true;
  window.INITIAL_PORT = 4444;
  window.INITIAL_TLS = true;
  window.INITIAL_PRIMARY_IP = '192.168.1.50';
  window.INITIAL_TOKEN = 'fixture-token';
  window.INITIAL_LOCALE = 'en';
  window.INITIAL_STORAGE_INITIALIZED = true;
  window.INITIAL_DURATION_CONFIDENCE = 'estimated';
  window.INITIAL_OSC_DIAGNOSTICS = fixture.oscDiagnostics;
  window.INITIAL_NETWORK = fixture.network;
  window.INITIAL_PROJECT = fixture.project;
  window.INITIAL_PLAYBACK = fixture.playback;
  window.INITIAL_PACKAGES = fixture.packages;
  window.INITIAL_CERT_URL = 'http://192.168.1.50:4445/ca';
  window.INITIAL_PEER = fixture.peer;
};

// The host of the panel: every answer the page sends is kept, so that the
// test can see what the panel asked for.
const hostInit = () => {
  window.__messages = [];
  window.webkit = {
    messageHandlers: {
      live: {
        postMessage: (message) => {
          window.__messages.push(message);
        },
      },
    },
  };
};

async function openPanel(page, { size = { width: 760, height: 600 } } = {}) {
  await page.setViewportSize(size);
  await page.addInitScript(livePanelInit, LIVE_FIXTURE);
  await page.addInitScript(hostInit);
  await page.goto('/panel/index.html');
}

async function sentEnvelopes(page) {
  return page.evaluate(() =>
    (window.__messages || []).map((message) => JSON.parse(message.params[0])),
  );
}

// The code inside the frame: the image the library draws, or the canvas it
// falls back to, and the box the frame takes.
async function qrFrame(page, frame) {
  return page.locator(frame).evaluate((element) => {
    const image = element.querySelector('img');
    const canvas = element.querySelector('canvas');
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      source: image ? image.src : canvas ? canvas.toDataURL() : '',
      width: rect.width,
    };
  });
}

// A QR frame once its code is drawn: the panel draws it asynchronously.
async function drawnQr(page, frame) {
  await expect.poll(async () => (await qrFrame(page, frame)).source).not.toBe('');
  return qrFrame(page, frame);
}

// The row of a setlist of the project.
function setlistRow(page, name) {
  return page.locator('#setlistProfiles .setlist-row').filter({ hasText: name });
}

test('the panel opens on the main section', async ({ page }) => {
  await openPanel(page);

  await expect(page.locator('#panelMain')).toBeVisible();
  await expect(page.locator('#tabMain')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#statusText')).toHaveText('Server running');
  await expect(page.locator('#mainProjectName')).toHaveText('Summer Tour');
  await expect(page.locator('#mainActiveProfile')).toHaveText('Main Setlist');
  await expect(page.locator('#mainSongCount')).toHaveText('3');
  await expect(page.locator('#mainDuration')).toHaveText('12:34');
  // One code, for the page the phone opens on the stage.
  await expect(page.locator('#accessLabel')).toHaveText('Stage Control');
  await expect(page.locator('#qrSetlist')).toBeVisible();
  await expect(page.locator('#qrStage')).toBeHidden();
});

test('the keyboard moves between the sections', async ({ page }) => {
  await openPanel(page);

  await page.locator('#tabMain').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tabSetlist')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tabSetlist')).toBeFocused();
  await expect(page.locator('#panelSetlist')).toBeVisible();
  await expect(page.locator('#panelMain')).toBeHidden();

  await page.keyboard.press('End');
  await expect(page.locator('#tabNetwork')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panelNetwork')).toBeVisible();

  await page.keyboard.press('Home');
  await expect(page.locator('#tabMain')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panelMain')).toBeVisible();
});

test('the server controls follow the state of the server', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_IS_RUNNING = false;
  });
  await page.reload();

  await expect(page.locator('#btnStart')).toBeEnabled();
  await expect(page.locator('#btnStop')).toBeDisabled();
  await expect(page.locator('#btnRestart')).toBeDisabled();
  await expect(page.locator('#btnDiagnoseOsc')).toBeDisabled();
  await expect(page.locator('#statusText')).toHaveText('Server stopped');
});

test('the panel speaks English and Brazilian Portuguese', async ({ page }) => {
  await openPanel(page);

  await expect(page.locator('#tabNetwork')).toHaveText('Network');
  await expect(page.locator('#langEn')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#langPt').click();

  await expect(page.locator('#tabNetwork')).toHaveText('Rede');
  await expect(page.locator('#tabSetlist')).toContainText('Repertórios');
  await expect(page.locator('#langPt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#langEn')).toHaveAttribute('aria-pressed', 'false');
  // The language the operator chose travels to the extension.
  await expect
    .poll(async () => (await sentEnvelopes(page)).map((envelope) => envelope.action))
    .toContain('set-language:pt-BR');
});

test('the network section shows every address of the machine', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabNetwork').click();

  await expect(page.locator('#networkPrimaryIp')).toHaveText('192.168.1.50');
  await expect(page.locator('#networkCandidates .candidate-row')).toHaveCount(2);
  await expect(page.locator('#networkCandidates')).toContainText('192.168.0.10');
  await expect(page.locator('#networkCandidates')).toContainText('Ethernet');
  await expect(page.locator('#networkCandidates')).toContainText('192.168.1.1');
  // The phone has to be on the network the computer is on.
  await expect(page.locator('#networkSubnetHint')).toContainText('192.168.1.0/24');
  await expect(page.locator('#networkProtocol')).toHaveText('HTTPS');
  await expect(page.locator('#networkPort')).toHaveText('4444');
  await expect(page.locator('#networkCaPort')).toHaveText('4445');
  await expect(page.locator('#networkCoverage')).toHaveText('Covered');
});

test('another address changes the links and every code', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabNetwork').click();

  const setlistUrl = 'https://192.168.1.50:4444/setlist?token=fixture-token';
  await expect(page.locator('#urlSetlist')).toHaveText(setlistUrl);
  await expect(page.locator('#openSetlist')).toHaveAttribute('href', setlistUrl);
  await page.locator('#btnCertToggle').click();
  await expect(page.locator('#certDetails')).toBeVisible();
  await expect(page.locator('#certUrl')).toHaveText('http://192.168.1.50:4445/ca');

  const stageBefore = await drawnQr(page, '#qrSetlist');
  const certBefore = await drawnQr(page, '#qrCert');

  await page.locator('#networkAddressSelect').selectOption('192.168.0.10');

  const otherUrl = 'https://192.168.0.10:4444/setlist?token=fixture-token';
  await expect(page.locator('#urlSetlist')).toHaveText(otherUrl);
  await expect(page.locator('#openSetlist')).toHaveAttribute('href', otherUrl);
  await expect(page.locator('#certUrl')).toHaveText('http://192.168.0.10:4445/ca');
  await expect(page.locator('#networkPrimaryIp')).toHaveText('192.168.0.10');

  // The codes are drawn after the change, so wait for each one to differ.
  for (const [frame, before] of [
    ['#qrSetlist', stageBefore],
    ['#qrCert', certBefore],
  ]) {
    await expect.poll(async () => (await qrFrame(page, frame)).source).not.toBe(before.source);
    expect((await qrFrame(page, frame)).source).not.toBe('');
  }

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0].action).toBe('select-address');
  expect(envelopes[0].address).toBe('192.168.0.10');
  expect(envelopes[0].tab).toBe('network');
});

test('an address the certificate does not cover cannot be chosen', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    const candidates = window.INITIAL_NETWORK.candidates.map((candidate) =>
      candidate.ip === '192.168.0.10' ? { ...candidate, covered: false } : candidate,
    );
    window.INITIAL_NETWORK = { ...window.INITIAL_NETWORK, candidates };
  });
  await page.reload();
  await page.locator('#tabNetwork').click();

  const option = page.locator('#networkAddressSelect option[value="192.168.0.10"]');
  // Playwright reads an option as enabled; the element itself says otherwise.
  await expect.poll(() => option.evaluate((element) => element.disabled)).toBe(true);
  // The address stays visible: the operator has to know it is there.
  await expect(page.locator('#networkCandidates')).toContainText('192.168.0.10');
});

test('a clipboard that is not there shows the address instead', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.reload();

  await expect(page.locator('#copyFallback')).toBeHidden();
  await page.locator('#btnCopySetlist').click();
  await expect(page.locator('#copyFallback')).toBeVisible();
  await expect(page.locator('#copyFallbackValue')).toHaveValue(
    'https://192.168.1.50:4444/setlist?token=fixture-token',
  );
});

test('the setlist of the project is chosen from the panel', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#setlistProfiles .setlist-row')).toHaveCount(2);
  await expect(page.locator('#setlistProfiles')).toContainText('Festival');
  await expect(setlistRow(page, 'Main Setlist')).toContainText('Active');

  await setlistRow(page, 'Festival').getByRole('button', { name: 'Activate' }).click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0].action).toBe('select-profile');
  expect(envelopes[0].profileId).toBe('two');
  expect(envelopes[0].tab).toBe('setlist');
});

test('the setlist is locked while the transport runs', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_PROJECT = { ...window.INITIAL_PROJECT, locked: true, lockReason: 'playing' };
    window.INITIAL_PLAYBACK = { ...window.INITIAL_PLAYBACK, isPlaying: true };
  });
  await page.reload();
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#setlistHint')).toContainText('transport');
  await expect(page.locator('#btnCreateSetlist')).toBeDisabled();
  await expect(page.locator('#setlistCreateName')).toBeDisabled();
  await expect(
    setlistRow(page, 'Festival').getByRole('button', { name: 'Activate' }),
  ).toBeDisabled();
  await expect(page.locator('#mainTransport')).toContainText('Playing');
});

test('a project without an active setlist lets the operator pick the first one', async ({
  page,
}) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_PROJECT = { ...window.INITIAL_PROJECT, activeProfileId: null };
  });
  await page.reload();
  await page.locator('#tabSetlist').click();

  const activate = setlistRow(page, 'Main Setlist').getByRole('button', { name: 'Activate' });
  await expect(activate).toBeVisible();
  await activate.click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0].profileId).toBe('one');
});

test('the active setlist chosen again sends nothing', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabSetlist').click();

  const active = setlistRow(page, 'Main Setlist');
  // The setlist that is active offers no button to choose it again.
  await expect(active.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  await active.getByRole('button', { name: 'Rename' }).click();
  await page.locator('#setlistProfiles input.text-input').press('Escape');

  expect(await sentEnvelopes(page)).toHaveLength(0);
});

test('a stopped server shows no page to open', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_IS_RUNNING = false;
  });
  await page.reload();

  await expect(page.locator('#statusText')).toHaveText('Server stopped');
  await expect(page.locator('#placeholderText')).toBeVisible();
  await expect(page.locator('#qrGrid')).toBeHidden();
  await expect(page.locator('#openSetlist')).toBeHidden();
  await expect(page.locator('#btnAccessSwap')).toBeHidden();
});

test('the certificate verdict follows the address that is chosen', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    const candidates = window.INITIAL_NETWORK.candidates.map((candidate) =>
      candidate.ip === '192.168.1.50' ? { ...candidate, covered: false } : candidate,
    );
    window.INITIAL_NETWORK = { ...window.INITIAL_NETWORK, certCoversSelected: false, candidates };
  });
  await page.reload();
  await page.locator('#tabNetwork').click();
  await expect(page.locator('#networkCoverage')).toHaveText('Not covered');

  await page.locator('#networkAddressSelect').selectOption('192.168.0.10');

  await expect(page.locator('#networkCoverage')).toHaveText('Covered');
});

test('pairing with an empty field sends nothing', async ({ page }) => {
  await openPanel(page);
  await page.locator('#tabNetwork').click();
  await page.locator('#btnPeerToggle').click();
  await page.locator('#btnPeerPair').click();

  expect(await sentEnvelopes(page)).toHaveLength(0);
  await expect(page.locator('#peerHostInput')).toBeFocused();
});

test('the code for a second computer is asked for in Portuguese too', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_LOCALE = 'pt-BR';
  });
  await page.reload();
  await page.locator('#tabNetwork').click();
  await page.locator('#btnPeerToggle').click();

  await expect(page.locator('#btnPeerCode')).toHaveText('Gerar código');
});

test('a project without setlists says so', async ({ page }) => {
  await openPanel(page);
  await page.addInitScript(() => {
    window.INITIAL_PROJECT = {
      ...window.INITIAL_PROJECT,
      projectName: '',
      profiles: [],
      locked: true,
      lockReason: 'no-project',
    };
  });
  await page.reload();
  await page.locator('#tabSetlist').click();

  await expect(page.locator('#mainProjectName')).toHaveText('No project open');
  await expect(page.locator('#setlistProfiles')).toContainText('No setlist in this project yet.');
  await expect(page.locator('#setlistHint')).toContainText('No project is open in Live.');
  await expect(page.locator('#btnCreateSetlist')).toBeDisabled();
});

test('the panel keeps its shape at the size of the modal', async ({ page }) => {
  await openPanel(page);

  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.tab-pane:not([hidden])');
    return {
      clientWidth: document.documentElement.clientWidth,
      paneClientWidth: pane.clientWidth,
      paneScrollWidth: pane.scrollWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.paneScrollWidth).toBeLessThanOrEqual(geometry.paneClientWidth);
});

test('the panel scrolls instead of flattening the code when the height runs out', async ({
  page,
}) => {
  await openPanel(page, { size: { width: 760, height: 400 } });

  const box = await qrFrame(page, '#qrSetlist');
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(96);

  const scroll = await page.evaluate(() => {
    const pane = document.querySelector('.tab-pane:not([hidden])');
    return { clientHeight: pane.clientHeight, scrollHeight: pane.scrollHeight };
  });
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

  const lastSong = page.locator('#mainSongs .song-row').last();
  await lastSong.scrollIntoViewIfNeeded();
  await expect(lastSong).toBeInViewport();
});
