// Task channels are stored in the existing category_code field, not channel_code.
export const TASK_CHANNEL_LABELS = Object.freeze({
  INSTAGRAM: "인스타그램",
  YOUTUBE: "유튜브",
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

export function taskChannelOptions(tasks = []) {
  const options = new Map();
  for (const task of tasks) {
    const code = String(task.categoryCode || task.category_code || "").trim().toUpperCase();
    if (code && !options.has(code)) options.set(code, TASK_CHANNEL_LABELS[code] || String(task.category || task.parent || code).trim() || code);
  }
  // Empty projects still need a small starter list, not every supported subtype.
  if (!options.size) for (const code of ["INSTAGRAM", "NAVER_BLOG", "YOUTUBE", "GOOGLE_SEARCH"]) options.set(code, TASK_CHANNEL_LABELS[code]);
  return [["", "미지정"], ...options];
}
