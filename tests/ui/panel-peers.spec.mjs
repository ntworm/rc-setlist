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

// The two computers paired with this one: the first one is talking.
const PAIRED_PEERS = [
  { host: '192.168.0.2', port: 4444, connected: true, markersMatch: true, statusText: 'Up' },
  { host: '192.168.0.3', port: 4444, connected: false, markersMatch: false, statusText: 'Down' },
];

// The sentence the extension writes for the role of this computer.
const MASTER_ROLE = 'Master \xB7 1 of 2 slaves connected';

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

// The panel as the extension hands it over, with this computer paired.
async function pairedWith(page, peer) {
  await page.addInitScript((overrides) => {
    window.INITIAL_PEER = { ...window.INITIAL_PEER, ...overrides };
  }, peer);
  await page.reload();
}

// The code inside the frame: the image the library draws, or the canvas it
// falls back to, and the box the frame takes.

test('the card of the second computer lists every paired computer', async ({ page }) => {
  await openPanel(page);
  await pairedWith(page, { peers: PAIRED_PEERS });
  await page.locator('#tabNetwork').click();

  const rows = page.locator('#peerList li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('192.168.0.2:4444');
  await expect(rows.nth(1)).toContainText('192.168.0.3:4444');
  await expect(rows.nth(0).locator('.peer-list-status')).toHaveClass(/active/);
  await expect(rows.nth(1).locator('.peer-list-status')).toHaveClass(/warning/);
  // The list is outside the folded card: it shows without opening it.
  await expect(page.locator('#peerDetails')).toBeHidden();

  // Each computer of the list has its own Unpair.
  await rows.nth(1).getByRole('button', { name: 'Unpair' }).click();

  const envelopes = await sentEnvelopes(page);
  expect(envelopes).toHaveLength(1);
  expect(envelopes[0].action).toBe('peer-unpair:192.168.0.3:4444');
});

test('the footer says the role of this computer', async ({ page }) => {
  await openPanel(page);
  // Without a pairing there is no role to say.
  await expect(page.locator('#peerRoleText')).toBeHidden();

  await pairedWith(page, { role: 'master', roleText: MASTER_ROLE, peers: PAIRED_PEERS });
  await expect(page.locator('#peerRoleText')).toBeVisible();
  await expect(page.locator('#peerRoleText')).toHaveText(MASTER_ROLE);
  // One of the two computers is quiet: the role is not in good shape.
  await expect(page.locator('#peerRoleText')).toHaveClass(/warning/);

  // Every computer of the list talking: the role is in good shape.
  await pairedWith(page, { role: 'master', roleText: MASTER_ROLE, peers: [PAIRED_PEERS[0]] });
  await expect(page.locator('#peerRoleText')).toHaveClass(/active/);
});

test('the second computer says which master it follows', async ({ page }) => {
  await openPanel(page);
  await pairedWith(page, {
    role: 'slave',
    roleText: 'Slave \xB7 connected to the master',
    slaveConnected: true,
    masterAddress: '192.168.1.50:4444',
  });
  await page.locator('#tabNetwork').click();

  await expect(page.locator('#peerMasterLine')).toBeVisible();
  await expect(page.locator('#peerMasterLine')).toHaveText('Slave of 192.168.1.50:4444');
  // The master is talking to this computer: the role is in good shape.
  await expect(page.locator('#peerRoleText')).toBeVisible();
  await expect(page.locator('#peerRoleText')).toHaveClass(/active/);
});
