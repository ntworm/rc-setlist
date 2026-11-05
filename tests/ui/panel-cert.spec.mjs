import { expect, test } from '@playwright/test';

// The Live panel as the extension hands it over: the server is up, the RC
// Bridge answered and the setlist duration is an estimate.
const livePanelInit = () => {
  window.INITIAL_IS_RUNNING = true;
  window.INITIAL_PORT = 4444;
  window.INITIAL_PRIMARY_IP = '192.168.100.2';
  window.INITIAL_TOKEN = 'fixture-token';
  window.INITIAL_LOCALE = 'en';
  window.INITIAL_STORAGE_INITIALIZED = true;
  window.INITIAL_DURATION_CONFIDENCE = 'estimated';
  window.INITIAL_OSC_DIAGNOSTICS = {
    state: 'responding',
    listenPort: 11101,
    rxCount: 12,
    txCount: 55,
    lastReplyAgeMs: 40,
    bridge: 'rcbridge',
    bridgeVersion: 'RC Bridge 1.2.0',
    targetPort: 11101,
  };
};

// Where the extension serves the certificate of this computer.
const CERT_URL = 'http://192.168.100.16:4445/ca';

async function openPanel(page, certUrl = CERT_URL) {
  await page.setViewportSize({ width: 760, height: 600 });
  await page.addInitScript(livePanelInit);
  await page.addInitScript((url) => {
    window.INITIAL_CERT_URL = url;
  }, certUrl);
  await page.goto('/panel/index.html');
}

// The code inside the square: the image the library draws, or the canvas it
// falls back to.
async function qrCodeTag(page, frame) {
  return page.locator(frame).evaluate((element) => {
    const visible = (node) => Boolean(node) && node.getClientRects().length > 0;
    const img = element.querySelector('img');
    const canvas = element.querySelector('canvas');
    const target = [img, canvas].filter(visible)[0] ?? null;
    return target ? target.tagName : null;
  });
}

test('the panel shows the certificate card when the server serves one', async ({ page }) => {
  await openPanel(page);

  await expect(page.locator('#phoneCertCard')).toBeVisible();
  await expect(page.locator('#certDetails')).toBeHidden();

  await page.locator('#btnCertToggle').click();
  await expect(page.locator('#certDetails')).toBeVisible();
  await expect(page.locator('#certUrl')).toHaveText(CERT_URL);
  expect(await qrCodeTag(page, '#qrCert'), '#qrCert must hold a QR code').not.toBeNull();
});

test('opening the second computer card closes the certificate card', async ({ page }) => {
  await openPanel(page);

  await page.locator('#btnCertToggle').click();
  await expect(page.locator('#certDetails')).toBeVisible();

  await page.locator('#btnPeerToggle').click();
  await expect(page.locator('#peerDetails')).toBeVisible();
  await expect(page.locator('#certDetails')).toBeHidden();
});

test('the certificate card stays hidden without a certificate to install', async ({ page }) => {
  await openPanel(page, '');

  await expect(page.locator('#phoneCertCard')).toBeHidden();
});
