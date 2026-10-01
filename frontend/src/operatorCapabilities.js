// Internal project operations are shared; Pocket-only data/global account
// administration remain separate. Server membership checks are authoritative.
export function canOperateProject(role, canWrite = true) {
  return Boolean(canWrite && ['pocket', 'ns'].includes(role));
}

export function operatorVisibilityOptions(role) {
  if (!canOperateProject(role)) return [];
  return [
    ['PROJECT_TEAM', '고객 숨김 · 내부만'],
    ['CLIENT', '고객 공개'],
    ...(role === 'pocket' ? [['POCKET_ONLY', '포켓 전용']] : []),
  ];
}
