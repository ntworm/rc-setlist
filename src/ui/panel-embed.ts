/**
 * Inlines CSS and JS assets into the panel HTML so the dialog is self-contained.
 * Throws if any expected asset tag is missing from the template.
 */
export function embedPanelAssets(
  html: string,
  assets: { uiSystemCss: string; i18nJs: string; qrJs: string },
): string {
  const cssTarget = /<link\s+rel="stylesheet"\s+href="\.\.\/shared\/ui-system\.css"\s*\/?>/i;
  const i18nTarget = /<script\s+src="\.\.\/shared\/i18n\.js"><\/script>/i;
  const qrTarget = /<script\s+src="qrcode\.js"><\/script>/i;

  if (typeof cssTarget === 'string' ? !html.includes(cssTarget) : !cssTarget.test(html)) {
    throw new Error('panel asset tag not found: ui-system.css');
  }
  if (!i18nTarget.test(html)) {
    throw new Error('panel asset tag not found: i18n.js');
  }
  if (!qrTarget.test(html)) {
    throw new Error('panel asset tag not found: qrcode.js');
  }

  html = html.replace(cssTarget, `<style>${assets.uiSystemCss}</style>`);
  html = html.replace(i18nTarget, `<script>${assets.i18nJs}</script>`);
  html = html.replace(qrTarget, `<script>${assets.qrJs}</script>`);

  return html;
}
