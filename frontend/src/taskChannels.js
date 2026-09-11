// Task channels are stored in the existing category_code field, not channel_code.
export const TASK_CHANNEL_LABELS = Object.freeze({
  INSTAGRAM: "인스타그램",
  YOUTUBE: "유튜브",
  NAVER: "네이버",
  NAVER_BLOG: "네이버 블로그",
  NAVER_SMARTPLACE: "네이버 플레이스",
  NAVER_SMARTSTORE: "네이버 스마트스토어",
  NAVER_ADS: "네이버 광고",
  GOOGLE_SEARCH: "구글 검색",
  META_ADS: "메타 광고",
  TIKTOK: "틱톡",
  WEBSITE: "자사몰",
  GEO: "AI 검색",
  ADS: "광고",
});

// Union of media actually registered across projects, verified 2026-09-11.
// Share names/codes only; never fetch another project's tasks to fill a picker.
export const SHARED_TASK_CHANNELS = Object.freeze(['NAVER', 'NAVER_BLOG', 'INSTAGRAM', 'YOUTUBE', 'TIKTOK', 'ADS']);

export function taskChannelOptions(tasks = []) {
  const options = new Map(SHARED_TASK_CHANNELS.map(code => [code, TASK_CHANNEL_LABELS[code]]));
  for (const task of tasks) {
    const code = String(task.categoryCode || task.category_code || "").trim().toUpperCase();
    if (code && !options.has(code)) options.set(code, TASK_CHANNEL_LABELS[code] || String(task.category || task.parent || code).trim() || code);
  }
  return [["", "미지정"], ...options];
}
