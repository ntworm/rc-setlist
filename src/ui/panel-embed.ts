/**
 * Folds the files of the panel into the page of the modal.
 *
 * The modal of Live has no server behind it: every stylesheet, script and
 * font has to travel inside the page, or the panel arrives broken. The
 * page of the kit is the opposite: it loads its neighbours and stays
 * readable.
 *
 * Nothing here reaches the network. The font of the panel travels as the
 * bytes it is, and the fonts of the shared stylesheet - four faces the
 * panel does not use - are taken out of the modal instead of being left
 * pointing at a server that is not there.
 */

import {
  PANEL_CSS_FILE,
  PANEL_SCRIPT_FILES,
  type PanelFontAsset,
  type PanelScriptAsset,
} from './panel-assets.js';

/** The assets the panel is made of. */
export interface PanelEmbedAssets {
  uiSystemCss: string;
  i18nJs: string;
  qrJs: string;
  panelCss?: string;
  panelScripts?: readonly PanelScriptAsset[];
  fonts?: readonly PanelFontAsset[];
}

const UI_SYSTEM_CSS_TAG = /<link\s+rel="stylesheet"\s+href="\.\.\/shared\/ui-system\.css"\s*\/?>/i;
const PANEL_CSS_TAG = new RegExp(
  `<link\\s+rel="stylesheet"\\s+href="${escapeRegExp(PANEL_CSS_FILE)}"\\s*\\/?>`,
  'i',
);
const I18N_TAG = /<script\s+src="\.\.\/shared\/i18n\.js"><\/script>/i;
const QR_TAG = /<script\s+src="qrcode\.js"><\/script>/i;

/**
 * Escapes the characters of a name that mean something in a pattern.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pattern of the script tag of a file.
 */
function scriptTag(file: string): RegExp {
  return new RegExp(`<script\\s+src="${escapeRegExp(file)}"><\\/script>`, 'i');
}

/**
 * Puts the content of an asset where the tag of the asset was.
 */
function inlineTag(html: string, pattern: RegExp, name: string, content: string): string {
  if (!pattern.test(html)) {
    throw new Error(`panel asset tag not found: ${name}`);
  }
  return html.replace(pattern, () => content);
}

/**
 * Puts a script where the tag of the script was.
 */
function inlineScript(html: string, file: string, code: string): string {
  return inlineTag(html, scriptTag(file), file, scriptElement(code));
}

/**
 * A script element whose code cannot close the element early.
 */
function scriptElement(code: string): string {
  return `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
}

/**
 * Takes the font faces of a stylesheet out of it.
 *
 * The shared stylesheet names four faces the panel never uses, and every
 * one of them points at a file of the kit that the modal cannot reach.
 */
export function stripFontFaces(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/gi, '');
}

/**
 * Puts the bytes of the fonts of the panel inside the stylesheet.
 */
export function inlineFontAssets(css: string, fonts: readonly PanelFontAsset[]): string {
  let out = css;
  for (const font of fonts) {
    const pattern = new RegExp(
      `url\\(\\s*(['"]?)\\.\\./fonts/${escapeRegExp(font.file)}\\1\\s*\\)`,
      'g',
    );
    out = out.replace(pattern, () => `url('data:font/woff2;base64,${font.base64}')`);
  }
  return out;
}

/**
 * Inlines CSS and JS assets into the panel HTML so the dialog is self-contained.
 * Throws if any expected asset tag is missing from the template.
 */
export function embedPanelAssets(html: string, assets: PanelEmbedAssets): string {
  let out = html;
  out = inlineTag(
    out,
    UI_SYSTEM_CSS_TAG,
    'ui-system.css',
    `<style>${stripFontFaces(assets.uiSystemCss)}</style>`,
  );
  out = inlineTag(out, I18N_TAG, 'i18n.js', scriptElement(assets.i18nJs));
  out = inlineTag(out, QR_TAG, 'qrcode.js', scriptElement(assets.qrJs));
  if (PANEL_CSS_TAG.test(out)) {
    if (assets.panelCss === undefined) {
      throw new Error(`panel asset not found: ${PANEL_CSS_FILE}`);
    }
    const css = inlineFontAssets(assets.panelCss, assets.fonts ?? []);
    out = inlineTag(out, PANEL_CSS_TAG, PANEL_CSS_FILE, `<style>${css}</style>`);
  }
  for (const file of PANEL_SCRIPT_FILES) {
    const pattern = scriptTag(file);
    if (!pattern.test(out)) continue;
    const script = (assets.panelScripts ?? []).find((entry) => entry.file === file);
    if (!script) {
      throw new Error(`panel asset not found: ${file}`);
    }
    out = inlineScript(out, file, script.code);
  }
  return out;
}
