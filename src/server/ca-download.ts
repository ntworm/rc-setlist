// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// The place where the phone gets the certificate authority. The certificate
// is served over plain HTTP on purpose: a phone that has to trust a
// certificate cannot be asked to trust the page that carries it.

import * as http from 'node:http';

/** The name the file is offered under. */
const CA_FILE_NAME = 'RC-Setlist-CA.crt';

/** The type the certificate of an authority is served with. */
const CA_CONTENT_TYPE = 'application/x-x509-ca-cert';

/** The page in Portuguese. */
const PORTUGUESE = {
  lang: 'pt-BR',
  title: 'RC Setlist — o certificado deste computador',
  intro: 'Instale o arquivo abaixo no celular para abrir o setlist sem aviso de segurança.',
  button: 'Baixar o certificado (RC-Setlist-CA.crt)',
  android: 'No Android',
  androidSteps: [
    'Toque no botão acima para baixar o arquivo RC-Setlist-CA.crt.',
    'Abra Configurações > Segurança > Criptografia e credenciais > Instalar um certificado > Certificado de CA. Os nomes exatos variam conforme a marca do aparelho.',
    'Escolha o arquivo RC-Setlist-CA.crt e confirme a instalação.',
  ],
  iphone: 'No iPhone',
  iphoneSteps: [
    'Toque no botão acima e permita o download do perfil.',
    'Abra Ajustes > Perfil Baixado e toque em Instalar.',
    'Abra Ajustes > Geral > Sobre > Configurações de Confiança de Certificados e ative RC Setlist local CA.',
  ],
  test: 'Abrir o setlist para testar',
};

/** The page in English. */
const ENGLISH = {
  lang: 'en',
  title: 'RC Setlist — the certificate of this computer',
  intro: 'Install the file below on the phone to open the setlist without a security warning.',
  button: 'Download the certificate (RC-Setlist-CA.crt)',
  android: 'On Android',
  androidSteps: [
    'Tap the button above to download the file RC-Setlist-CA.crt.',
    'Open Settings > Security > Encryption and credentials > Install a certificate > CA certificate. The exact menu names vary by brand.',
    'Pick the file RC-Setlist-CA.crt and confirm the installation.',
  ],
  iphone: 'On iPhone',
  iphoneSteps: [
    'Tap the button above and allow the profile to download.',
    'Open Settings > Profile Downloaded and tap Install.',
    'Open Settings > General > About > Certificate Trust Settings and turn on RC Setlist local CA.',
  ],
  test: 'Open the setlist to test',
};

/** The words of the page, in the language the phone asks for. */
type PageCopy = typeof PORTUGUESE;

/** The style of the page: dark, inlined, and nothing that has to be fetched. */
const STYLE = `
:root { color-scheme: dark; }
body { margin: 0; background: #101014; color: #e9e9ef; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55; }
main { max-width: 34rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
h1 { font-size: 1.45rem; margin: 0 0 0.75rem; } h2 { font-size: 1.05rem; margin: 2rem 0 0.5rem; }
p, ol { margin: 0 0 1rem; } ol { padding-left: 1.25rem; } li { margin-bottom: 0.65rem; }
a { color: #8ab4ff; }
.button { display: inline-block; padding: 0.95rem 1.3rem; border-radius: 0.6rem; background: #2f6feb; color: #fff; font-weight: 600; text-decoration: none; }
.test a { display: inline-block; padding: 0.8rem 1.1rem; border: 1px solid #3a3a45; border-radius: 0.6rem; text-decoration: none; }
`;

/**
 * Escapes the text that goes into the page. The angle bracket that closes
 * a step of a menu path is left alone: it is valid in the body of a page.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The language the phone asks for. */
function prefersPortuguese(req: http.IncomingMessage): boolean {
  const header = req.headers['accept-language'];
  if (typeof header !== 'string') return false;
  return header.trim().toLowerCase().startsWith('pt');
}

/**
 * The name of the computer the page was asked for: the phone reached this
 * computer by name, so the name is what the link back carries.
 */
function requestHostname(req: http.IncomingMessage): string {
  const header = req.headers.host;
  const host = typeof header === 'string' ? header.trim() : '';
  if (host) {
    const name = host.startsWith('[')
      ? host.slice(0, host.indexOf(']') + 1)
      : (host.split(':')[0] ?? '');
    if (name) return name;
  }
  const address = req.socket?.localAddress;
  return typeof address === 'string' && address ? address : 'localhost';
}

/** The list of steps, as the page shows it. */
function renderSteps(steps: string[]): string {
  return steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
}

/** The page that says where to put the certificate. */
function renderPage(copy: PageCopy, testUrl: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(copy.lang)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.intro)}</p>
<p><a class="button" href="/ca.crt">${escapeHtml(copy.button)}</a></p>
<h2>${escapeHtml(copy.android)}</h2>
<ol>${renderSteps(copy.androidSteps)}</ol>
<h2>${escapeHtml(copy.iphone)}</h2>
<ol>${renderSteps(copy.iphoneSteps)}</ol>
<p class="test"><a href="${escapeHtml(testUrl)}">${escapeHtml(copy.test)}</a></p>
</main>
</body>
</html>
`;
}

/** Answers with the certificate of the authority. */
function sendCertificate(res: http.ServerResponse, der: Buffer): void {
  res.writeHead(200, {
    'Content-Type': CA_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${CA_FILE_NAME}"`,
    'Cache-Control': 'no-store',
    'Content-Length': String(der.length),
  });
  res.end(der);
}

/** Answers with the page that says where to put the certificate. */
function sendPage(res: http.ServerResponse, req: http.IncomingMessage, httpsPort: number): void {
  const copy = prefersPortuguese(req) ? PORTUGUESE : ENGLISH;
  const body = renderPage(copy, `https://${requestHostname(req)}:${httpsPort}/setlist`);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** Answers that there is nothing here. */
function sendNotFound(res: http.ServerResponse): void {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('Not found');
}

/**
 * The listener that hands the authority of this computer to the phone.
 * Nothing else is answered here.
 */
export function createCaDownloadListener(
  getCaDer: () => Buffer | null,
  httpsPort: number,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (req.method !== 'GET' || (path !== '/ca.crt' && path !== '/ca' && path !== '/ca/')) {
      sendNotFound(res);
      return;
    }
    const der = getCaDer();
    if (!der) {
      sendNotFound(res);
      return;
    }
    if (path === '/ca.crt') {
      sendCertificate(res, der);
      return;
    }
    sendPage(res, req, httpsPort);
  };
}
