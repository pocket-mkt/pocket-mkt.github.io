// Synthetic fixture only: never commit customer schedule exports.
export function scheduleFixture(count = 43) {
  return { campaigns: [{ name: '일정 QA', start: '2026-10-01', end: '2026-10-31', rows: Array.from({ length: count }, (_, index) => ({
    id: `qa-${index}`, media: ['홈페이지','YouTube','Instagram','네이버블로그','Ads'][index % 5],
    task: `QA 업무 ${index + 1}`, detail: '합성 테스트 일정', owner: index % 2 ? '포켓' : 'NS', status: '예정',
    start: '2026-10-01', end: '2026-10-31', days: index === 0 ? [-1,0,5] : index === 1 ? [] : [index % 30],
    ...(index === 2 ? { parentId: 'qa-0' } : {}), link: '', note: '',
  })) }] };
}
export const scheduleHtml = data => `<html><body><script>globalThis.scheduleHtmlExecuted = true;</script><script id="seed" type="application/json">${JSON.stringify(data)}</script><img src="https://invalid.example/never-load.png"></body></html>`;
