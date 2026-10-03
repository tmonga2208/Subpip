// The frame every customer email sits in: a preview line for the inbox, the
// SubPIP mark, one card and a footer. Mail apps block images and strip
// stylesheets, so it is built from tables and inline styles alone; the <style>
// block only adds the phone layout and dark mode where a mail app honors them.

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
export const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Light colors are inline; these classes swap them for the site's dark palette
const STYLES = `
@media (max-width: 480px) {
  .card { padding: 28px 20px 24px !important; }
  .key { font-size: 17px !important; }
}
@media (prefers-color-scheme: dark) {
  .page { background: #0b0b0c !important; }
  .card { background: #17181b !important; border-color: #25262a !important; }
  .ink { color: #f2f2f2 !important; }
  .soft { color: #a1a1aa !important; }
  .keybox { background: #2a171b !important; border-color: #5c2530 !important; }
  .rule { border-color: #25262a !important; }
  .done { background: #10231b !important; border-color: #1f4a39 !important; color: #7ee2b8 !important; }
  .num { background: #2c2d32 !important; }
  .link { color: #ff7a86 !important; }
}`;

// The site's logo (a screen with a caption bar), drawn with table cells
const MARK = `<table ${TABLE}><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="#ff4d5e" style="width:36px;height:36px;background:#ff4d5e;border-radius:9px">
<table ${TABLE} align="center"><tr><td width="18" height="10" align="center" valign="bottom" style="width:18px;height:10px;border:2px solid #ffffff;border-radius:4px;padding:0 0 3px;font-size:0;line-height:0">
<table ${TABLE} align="center"><tr><td width="12" height="3" bgcolor="#ffffff" style="width:12px;height:3px;background:#ffffff;border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>
</td></tr></table>
</td>
<td class="ink" style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:700;line-height:36px;color:#18181b">SubPIP</td>
</tr></table>`;

// Invisible filler, so the inbox preview stops at the preview line
const PREVIEW_FILLER = '&#847;&zwnj;&nbsp;'.repeat(40);

// preview: the line an inbox shows beside the subject. content and footer are
// HTML the caller has already escaped.
export function emailLayout({ title, preview, content, footer }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${STYLES}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preview)}${PREVIEW_FILLER}</div>
<table ${TABLE} class="page" width="100%" style="background:#f4f4f5"><tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table ${TABLE} align="center" width="560"><tr><td><![endif]-->
<table ${TABLE} width="100%" style="max-width:560px">
<tr><td style="padding:0 4px 20px">${MARK}</td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:36px 36px 32px">
${content}
</td></tr>
<tr><td style="padding:20px 4px 0">
${footer}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}
