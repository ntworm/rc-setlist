/**
 * The files the panel is made of, read from the bundle.
 *
 * The panel runs in two places: as a page of the kit, where the browser
 * loads the files next to it, and as the modal of Live, where there is no
 * server to load anything and every file has to travel inside the page.
 *
 * This module knows the files. The embedding module knows how to fold them
 * into the page.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** The scripts of the panel, in the order they run. */
export const PANEL_SCRIPT_FILES: readonly string[] = [
  'panel-shell.js',
  'panel-copy.js',
  'panel-network.js',
  'panel-project.js',
  'panel-main.js',
  'panel.js',
];

/** The stylesheet of the panel. */
export const PANEL_CSS_FILE = 'panel.css';

/** The font the panel is written in: Martian Mono, the face of the pages of RC Setlist. */
export const PANEL_FONT_FILES: readonly string[] = [
  'MartianMono-latin.woff2',
  'MartianMono-latin-ext.woff2',
];

/** One script of the panel. */
export interface PanelScriptAsset {
  file: string;
  code: string;
}

/** One font of the panel, as the bytes a page can carry. */
export interface PanelFontAsset {
  file: string;
  base64: string;
}

/** Everything the panel is made of. */
export interface PanelAssets {
  uiSystemCss: string;
  i18nJs: string;
  qrJs: string;
  panelCss: string;
  panelScripts: PanelScriptAsset[];
  fonts: PanelFontAsset[];
}

/** Where the files of the panel live. */
export interface PanelAssetOptions {
  panelDir: string;
  sharedDir: string;
  fontsDir: string;
}

/**
 * Reads every file the panel is made of.
 */
export async function loadPanelAssets(options: PanelAssetOptions): Promise<PanelAssets> {
  const [uiSystemCss, i18nJs, qrJs, panelCss] = await Promise.all([
    fs.readFile(path.join(options.sharedDir, 'ui-system.css'), 'utf8'),
    fs.readFile(path.join(options.sharedDir, 'i18n.js'), 'utf8'),
    fs.readFile(path.join(options.panelDir, 'qrcode.js'), 'utf8'),
    fs.readFile(path.join(options.panelDir, PANEL_CSS_FILE), 'utf8'),
  ]);
  const panelScripts: PanelScriptAsset[] = [];
  for (const file of PANEL_SCRIPT_FILES) {
    const code = await fs.readFile(path.join(options.panelDir, file), 'utf8');
    panelScripts.push({ file, code });
  }
  const fonts: PanelFontAsset[] = [];
  for (const file of PANEL_FONT_FILES) {
    try {
      const bytes = await fs.readFile(path.join(options.fontsDir, file));
      fonts.push({ file, base64: bytes.toString('base64') });
    } catch {
      // The font is a comfort, not a requirement: without it the panel falls
      // back to the monospace font of the system.
    }
  }
  return { uiSystemCss, i18nJs, qrJs, panelCss, panelScripts, fonts };
}
