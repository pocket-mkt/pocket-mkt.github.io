export const MAX_REPORT_BYTES = 3 * 1024 * 1024;
export const REPORT_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function validateReportFile(file, html) {
  if (!file || !/\.html?$/i.test(file.name) || file.name.length > 200) throw Error('HTML 파일(.html 또는 .htm)을 선택해 주세요.');
  if (!file.size || file.size > MAX_REPORT_BYTES || new TextEncoder().encode(html).length > MAX_REPORT_BYTES) throw Error('보고서는 최대 3MB까지 업로드할 수 있습니다.');
  if (!/<(html|body|head|div|section|main|article|h[1-6])([\s>])/i.test(html) || html.includes('\u0000')) throw Error('유효한 HTML 보고서가 아닙니다. UTF-8로 저장한 파일을 사용해 주세요.');
}

export function reportDocument(html) {
  // Never parse uploaded resources in the app's DOM. The iframe parses them only
  // AFTER the policy is installed, retaining original body styles and chart scripts.
  // A later CSP in the uploaded document cannot weaken this first policy.
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}"><meta name="referrer" content="no-referrer">\n${String(html)}`;
}

export function reportMonthLabel(month) {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}
