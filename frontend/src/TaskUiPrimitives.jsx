import { FolderOpen, LoaderCircle, AlertCircle, RefreshCw } from "lucide-react";

const statusClass = {
  할일: "status status-muted",
  미착수: "status status-muted",
  완료: "status status-success",
  진행: "status status-active",
  진행중: "status status-active",
  검토: "status status-review",
  "고객 확인": "status status-waiting",
  대기: "status status-muted",
  기획: "status status-active",
  제작: "status status-review",
  게시예약: "status status-success",
  차단: "status status-waiting",
  보류: "status status-muted",
  초안: "status status-muted",
  예정: "status status-active",
};

function formatSyncTime(value) {
  if (!value) return "동기화 전";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function EmptyState({ title, description }) {
  return <div className="empty-state"><FolderOpen size={22} strokeWidth={1.7} /><strong>{title}</strong><span>{description}</span></div>;
}

function LoadingState({ label = "프로젝트 데이터를 불러오는 중입니다." }) {
  return <div className="state-panel is-loading" role="status"><LoaderCircle size={22} className="spin" /><strong>{label}</strong><span>창을 닫지 않아도 됩니다.</span></div>;
}

function ErrorState({ error, onRetry, title = "데이터를 불러오지 못했습니다." }) {
  return <div className="state-panel is-error" role="alert"><AlertCircle size={22} /><strong>{title}</strong><span>{error?.message || "연결 상태를 확인한 뒤 다시 시도해 주세요."}</span>{onRetry && <button className="secondary-button" onClick={onRetry}><RefreshCw size={15} /> 다시 시도</button>}</div>;
}

function FormSelect({ label, value, onChange, options }) {
  return <label className="create-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>;
}

const trackerStatusOptions = [
  ["NOT_STARTED", "미착수"],
  ["IN_PROGRESS", "진행"],
  ["DONE", "완료"],
  ["ON_HOLD", "보류"],
];

const trackerStatusLabels = {
  TODO: "미착수",
  NOT_STARTED: "미착수",
  IN_PROGRESS: "진행",
  INTERNAL_REVIEW: "검토",
  WAITING_CLIENT: "고객 확인",
  REVISION: "검토",
  BLOCKED: "차단",
  ON_HOLD: "보류",
  DONE: "완료",
  COMPLETED: "완료",
  CANCELLED: "취소",
};

function trackerDate(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export { statusClass, formatSyncTime, EmptyState, LoadingState, ErrorState, FormSelect, trackerStatusOptions, trackerStatusLabels, trackerDate, localDateValue };
