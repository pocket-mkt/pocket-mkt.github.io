import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpenText,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  FolderOpen,
  GripVertical,
  History,
  FileUp,
  LayoutDashboard,
  KeyRound,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  MousePointerClick,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Trash2,
  Video,
  WifiOff,
  X,
} from "lucide-react";
import {
  activityListViewModel,
  accessAdminViewModel,
  bootstrapViewModel,
  contentsViewModel,
  credentialsViewModel,
  dailyMeetingsViewModel,
  createHubDataSource,
  overviewViewModel,
  operationsDashboardViewModel,
  planViewModel,
  performanceTrackingViewModel,
  performanceViewModel,
  projectIssueViewModel,
  taskResponsibleOrganization,
  tasksViewModel,
} from "./api/index.js";
import { getNavigationPresentation } from "./navigationState.js";
import {
  DEFAULT_PLAN_VARIANT,
  PLAN_VARIANTS,
  parseViewLocation,
  viewLocationHash,
  viewResourceKey,
} from "./planNavigation.js";
import { canOperateProjectTasks, taskResponsibleOrgLabel, taskResponsibleOrgOptions, taskStatusMutationFields, taskUpdateInitialFields, taskUpdateSubmissionFields } from "./taskForm.js";
import { acquireBodyScrollLock } from "./bodyScrollLock.js";
import { disclosureChevronDirection, disclosureChevronGlyph, expandSelectedTaskGroup, toggleCollapsedTaskGroup } from "./taskGroupState.js";
import { buildTaskTimeline, filterTaskSchedule, groupTaskScheduleByMedia, reorderTaskSchedule, selectTaskRange, taskHiddenFromClient, taskScheduleCategory, taskScheduleMedia, taskScheduleMediaCode, taskScheduleStatusGroup, toggleScheduleStatusFilter, withDisplayDeadline } from "./taskTimeline.js";
import { buildGanttAxis, ganttMonthClass, ganttTaskLabelWidth, groupGanttTasks, normalizeScheduleDates, paintGanttRectangle, scheduleDateBounds, scheduleDateRange, scheduleDatesEqual, serializeScheduleDates, taskScheduleDates } from "./taskGantt.js";
import { filterTaskActivities, groupTaskActivitiesByDate, readableTaskActivities, taskActivityDateKey, taskActivitySentence } from "./taskActivity.js";
import { isNewTask, unacknowledgedNewTasks } from "./taskFreshness.js";
import { effectiveTaskScheduleState, overdueTaskHoldRange } from "./taskScheduleStatus.js";
import { KPI_CHANNEL_OPTIONS, KPI_PERIOD_OPTIONS, KPI_UNIT_OPTIONS, kpiInitialFields, kpiSubmissionFields } from "./kpiForm.js";
import { ACCESS_PAGE_OPTIONS, NAVIGATION_PAGE_OPTIONS, PROJECT_NAVIGATION_GROUP, accountSubmission, firstAllowedView, isViewAllowed, normalizeAllowedPages, removeAccessSubmission } from "./accessPermissions.js";
import { dailyMetricSeries, trackingFunnel, trackingSignals, TRACKING_METRICS } from "./performanceTracking.js";
import {
  clearResourceSessionCache,
  readResourceSessionCache,
  removeResourceSessionCache,
  scheduleResourceSessionCacheWrite,
} from "./resourceSessionCache.js";
import { QuoteSummary } from "./QuoteSummary.jsx";
import { useOverviewResource } from "./useOverviewResource.js";
import { invalidateResourceReads, invalidateWorkspaceCaches, WORKSPACE_SUMMARY_KEYS } from "./resourceInvalidation.js";
import IssueRequestCard from "./IssueRequestCard.jsx";
const IssueRequestCreateModal = lazy(() => import("./IssueRequestCreateModal.jsx"));

const SAVE_OVERLAY_MIN_MS = 500;
const SAVE_OVERLAY_COALESCE_MS = 250;
const GANTT_DAY_WIDTH = 24;
const CredentialLedgerView = lazy(() => import("./CredentialLedgerView.jsx").then((module) => ({ default: module.CredentialLedgerView })));
const OperationsDashboardView = lazy(() => import("./OperationsDashboardView.jsx").then((module) => ({ default: module.OperationsDashboardView })));
const WorkspaceDailyMeetingsView = lazy(() => import("./OperationsDashboardView.jsx").then((module) => ({ default: module.WorkspaceDailyMeetingsView })));
const ProgressView = lazy(() => import("./ProgressView.jsx").then((module) => ({ default: module.ProgressView })));
const ClientProgressView = lazy(() => import("./ClientProgressView.jsx").then((module) => ({ default: module.ClientProgressView })));
const TaskCreateModal = lazy(() => import("./TaskCreateModal.jsx").then((module) => ({ default: module.TaskCreateModal })));
const QuoteImportModal = lazy(() => import("./QuoteImportModal.jsx"));

const navIcons = {
  overview: LayoutDashboard,
  portfolio: FolderOpen,
  plan: BookOpenText,
  tasks: ClipboardCheck,
  schedule: CalendarDays,
  progress: CircleDot,
  "client-progress": CircleDot,
  daily: NotebookPen,
  credentials: KeyRound,
  performance: BarChart3,
  files: Activity,
};
const navItems = [
  ...NAVIGATION_PAGE_OPTIONS.filter((page) => page.id !== "overview").map((page) => ({
    ...page,
    icon: navIcons[page.id],
    ...(page.id === "plan" ? { children: Object.values(PLAN_VARIANTS) } : {}),
  })),
  { id: "permissions", label: "권한 관리", icon: ShieldCheck, accessManagerOnly: true },
];

function canManageClientAccess(role) {
  return role === "pocket" || role === "ns";
}

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

function sourceFactory() {
  try {
    return { source: createHubDataSource(), error: null };
  } catch (error) {
    return { source: null, error };
  }
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function formatSyncTime(value) {
  if (!value) return "동기화 전";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function ProgressBar({ value, color = "var(--accent)" }) {
  if (value === null || value === undefined) return null;
  return <div className="progress-track" aria-label={`${value}% 진행`}><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: color }} /></div>;
}

function EmptyState({ title, description }) {
  return <div className="empty-state"><FolderOpen size={22} strokeWidth={1.7} /><strong>{title}</strong><span>{description}</span></div>;
}

function LoadingState({ label = "프로젝트 데이터를 불러오는 중입니다." }) {
  return <div className="state-panel is-loading" role="status"><LoaderCircle size={22} className="spin" /><strong>{label}</strong><span>창을 닫지 않아도 됩니다.</span></div>;
}

function GlobalSaveOverlay({ label }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    const releaseScrollLock = acquireBodyScrollLock();
    overlayRef.current?.focus();
    return releaseScrollLock;
  }, []);
  return <div ref={overlayRef} className="global-save-overlay" role="dialog" aria-modal="true" aria-labelledby="global-save-title" aria-describedby="global-save-description" tabIndex={-1} onKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="global-save-dialog">
      <span className="global-save-icon" aria-hidden="true"><LoaderCircle size={24} className="spin" /></span>
      <div><strong id="global-save-title">데이터 저장 중</strong><span id="global-save-description">{label || "변경사항을 안전하게 기록하고 있습니다."}</span></div>
    </div>
  </div>;
}

function ErrorState({ error, onRetry, title = "데이터를 불러오지 못했습니다." }) {
  return <div className="state-panel is-error" role="alert"><AlertCircle size={22} /><strong>{title}</strong><span>{error?.message || "연결 상태를 확인한 뒤 다시 시도해 주세요."}</span>{onRetry && <button className="secondary-button" onClick={onRetry}><RefreshCw size={15} /> 다시 시도</button>}</div>;
}

function LoginScreen({ onLogin, error, loading, configured }) {
  const [account, setAccount] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (!account.trim() || !accessCode) return;
    await onLogin({ account: account.trim(), accessCode });
  };
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><LockKeyhole size={20} /></div>
        <div className="login-heading"><span>포켓컴퍼니</span><h1>마케팅 프로젝트 허브</h1><p>배정된 고객사와 프로젝트만 표시됩니다.</p></div>
        <form onSubmit={submit}>
          <label><span>아이디</span><input type="text" autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="아이디 입력" disabled={loading || !configured} /></label>
          <label><span>비밀번호</span><input type="password" autoComplete="current-password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="비밀번호 입력" disabled={loading || !configured} /></label>
          {error && <div className="login-error"><AlertCircle size={15} />{error.message}</div>}
          {!configured && <div className="login-error"><WifiOff size={15} />운영 API 주소가 설정되지 않았습니다.</div>}
          <button className="primary-button login-submit" disabled={loading || !configured || !account.trim() || !accessCode}>{loading ? <><LoaderCircle size={16} className="spin" /> 확인 중</> : "로그인"}</button>
        </form>
        <footer><ShieldCheck size={14} /> 비밀번호는 브라우저에 저장하지 않고, 발급된 세션만 현재 탭에 보관합니다.</footer>
      </section>
    </main>
  );
}

export function ProjectSidebar({ project, role, activeView, activePlanVariant, onView, open, onClose, taskCount, visible, clients = [], activeClient, onSelectClient, onCreateProject, onImportQuote, canCreateProject, navigation, onToggleNavigation }) {
  const [planExpanded, setPlanExpanded] = useState(activeView === "plan");
  const [projectExpanded, setProjectExpanded] = useState(true);

  useEffect(() => {
    if (activeView === "plan") setPlanExpanded(true);
    if (PROJECT_NAVIGATION_GROUP.pageIds.includes(activeView) || activeView === "schedule") setProjectExpanded(true);
  }, [activeView]);

  const visiblePlanChildren = role === "client" ? [PLAN_VARIANTS.client] : Object.values(PLAN_VARIANTS);
  const visibleNavItems = navItems.filter((item) => {
    if (item.accessManagerOnly) return canManageClientAccess(role);
    if (role !== "client") return true;
    return isViewAllowed(item.id, project.allowedPages);
  });
  const workspaceNavItem = visibleNavItems.find((item) => item.id === "portfolio");
  const projectNavItems = visibleNavItems.filter((item) => item.id !== "portfolio");
  const projectNavChildren = projectNavItems.filter(item => PROJECT_NAVIGATION_GROUP.pageIds.includes(item.id));
  const projectContextActive = activeView !== "portfolio";

  return (
    <aside id="project-navigation" className={`project-sidebar ${open ? "is-open" : ""}`} aria-label="프로젝트 탐색">
      <div className="sidebar-menu-header">{visible && <strong>프로젝트 · 메뉴</strong>}<button className="sidebar-toggle" type="button" onClick={onToggleNavigation} aria-label={navigation.actionLabel} title={navigation.actionLabel} aria-expanded={visible} aria-controls={navigation.controlledIds}>{visible ? <ChevronLeft size={20} strokeWidth={2.5} /> : <ChevronRight size={20} strokeWidth={2.5} />}</button></div>
      <div id="project-navigation-content" className="sidebar-workspace-content" hidden={!visible}>
      <div className="sidebar-workspace-scroll">
      {workspaceNavItem && <nav className="sidebar-global-nav" aria-label="전체 프로젝트"><button type="button" className={activeView === "portfolio" ? "is-active" : ""} aria-current={activeView === "portfolio" ? "page" : undefined} onClick={() => { onView("portfolio"); onClose(); }}><FolderOpen size={18} strokeWidth={1.9} /><span><strong>통합 관리</strong><small>전체 프로젝트 운영 현황</small></span><ChevronRight size={15} /></button></nav>}
      <section className="sidebar-projects"><span className="sidebar-section-label">프로젝트</span><nav className="sidebar-company-list" aria-label="프로젝트 회사 선택">{clients.map(client => { const selected = projectContextActive && client.id === activeClient; return <button key={client.id} type="button" className={selected ? "is-active" : ""} aria-current={selected ? "true" : undefined} onClick={() => { onSelectClient(client.id); onClose(); }}><span>{client.name}</span>{selected && <Check size={15} strokeWidth={2.5} />}</button>; })}</nav>{projectContextActive && <p className="sidebar-current-project" title={project.name}>{project.name}</p>}</section>
      <span className="sidebar-section-label sidebar-pages-label">메뉴</span>
      <nav className="project-nav">{projectNavItems.map((item) => {
        const Icon = item.icon;
        if (PROJECT_NAVIGATION_GROUP.pageIds.includes(item.id)) {
          if (item.id !== projectNavChildren[0]?.id) return null;
          return <div key={PROJECT_NAVIGATION_GROUP.id} className={`project-nav-tree project-workspace-tree ${projectExpanded ? "is-expanded" : ""}`}>
            <button type="button" className="project-group-toggle" onClick={() => setProjectExpanded(current => !current)} aria-expanded={projectExpanded} aria-controls="project-page-links"><FolderOpen size={17} strokeWidth={1.8} /><span>{PROJECT_NAVIGATION_GROUP.label}</span><ChevronDown className="nav-tree-chevron" size={14} /></button>
            {projectExpanded && <div id="project-page-links" className="project-nav-children">{projectNavChildren.map(child => {
              const ChildIcon = child.icon;
              const active = activeView === child.id || (child.id === "tasks" && activeView === "schedule");
              return <button key={child.id} type="button" className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={() => { onView(child.id); onClose(); }}><ChildIcon size={16} strokeWidth={1.8} /><span>{child.label}</span>{child.id === "tasks" && taskCount > 0 && <em>{taskCount}</em>}</button>;
            })}</div>}
          </div>;
        }
        if (item.id !== "plan") return <button key={item.id} className={`${activeView === item.id || (item.id === "tasks" && activeView === "schedule") || (item.id === "tasks" && activeView === "progress") ? "is-active" : ""} ${item.nested ? "is-nested" : ""}`} onClick={() => { onView(item.id); onClose(); }}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "tasks" && taskCount > 0 && <em>{taskCount}</em>}</button>;
        return <div key={item.id} className={`project-nav-tree ${planExpanded ? "is-expanded" : ""}`}>
          <button type="button" className={activeView === "plan" ? "is-active" : ""} onClick={() => {
            if (activeView !== "plan") onView("plan", DEFAULT_PLAN_VARIANT);
            setPlanExpanded((current) => activeView === "plan" ? !current : true);
          }} aria-expanded={planExpanded}>
            <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span><ChevronDown className="nav-tree-chevron" size={14} />
          </button>
          {planExpanded && <div className="project-nav-children">
            {visiblePlanChildren.map((child) => {
              return <button key={child.id} type="button" className={activeView === "plan" && activePlanVariant === child.id ? "is-active" : ""} onClick={() => { onView("plan", child.id); onClose(); }} aria-current={activeView === "plan" && activePlanVariant === child.id ? "page" : undefined}><span className="nav-child-branch" aria-hidden="true" /><span>{child.label}</span></button>;
            })}
          </div>}
        </div>;
      })}</nav>
      </div>
      {canCreateProject && <footer className="sidebar-project-tools"><button type="button" className="sidebar-project-create" onClick={() => { onCreateProject(); onClose(); }}><Plus size={16} strokeWidth={2.3} />프로젝트 생성</button><button type="button" className="sidebar-project-import" onClick={() => { onImportQuote(); onClose(); }}><FileUp size={16} strokeWidth={2} />견적서 불러오기</button></footer>}
      </div>
    </aside>
  );
}

function ActorBadge({ actor, onLogout, live }) {
  return <div className="actor-badge"><span><strong>{actor?.name || "사용자"}</strong><small>{actor?.role === "client" ? "고객 조회" : actor?.role === "ns" ? "실행사 편집" : "포켓 운영"}</small></span>{live && <button className="icon-button" onClick={onLogout} aria-label="로그아웃" title="로그아웃"><LogOut size={16} /></button>}</div>;
}

function readAcknowledgedTaskIds(storageKey) {
  try {
    const stored = JSON.parse(globalThis.sessionStorage?.getItem(storageKey) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

function notificationTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "등록 시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function TaskNotificationCenter({ projectId, tasks, loaded, onSelect }) {
  const [open, setOpen] = useState(false);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const storageKey = `mh:new-task-alert:${projectId || "unknown"}`;
  const [acknowledgedTaskIds, setAcknowledgedTaskIds] = useState(() => readAcknowledgedTaskIds(storageKey));
  const rootRef = useRef(null);
  const newTasks = useMemo(() => (tasks || [])
    .filter((task) => isNewTask(task, freshnessNow))
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")), [tasks, freshnessNow]);
  const unreadTasks = useMemo(
    () => unacknowledgedNewTasks(newTasks, acknowledgedTaskIds, freshnessNow),
    [newTasks, acknowledgedTaskIds, freshnessNow],
  );
  const timestampsAvailable = !loaded || tasks.length === 0 || tasks.some((task) => Boolean(task.createdAt));

  useEffect(() => {
    setOpen(false);
    setAcknowledgedTaskIds(readAcknowledgedTaskIds(storageKey));
    setFreshnessNow(Date.now());
  }, [storageKey]);

  useEffect(() => {
    const timer = globalThis.setInterval?.(() => setFreshnessNow(Date.now()), 60 * 1000);
    return () => globalThis.clearInterval?.(timer);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const acknowledge = (taskIds) => {
    const next = [...new Set([...acknowledgedTaskIds, ...taskIds.map(String)])];
    setAcknowledgedTaskIds(next);
    try {
      globalThis.sessionStorage?.setItem(storageKey, JSON.stringify(next));
    } catch {
      // 저장소가 막혀도 현재 탭의 확인 상태는 유지한다.
    }
  };

  const openTask = (task) => {
    acknowledge([task.id]);
    setOpen(false);
    onSelect?.(task);
  };

  return <div className="notification-center" ref={rootRef}>
    <button type="button" className={`notification-trigger${open ? " is-open" : ""}`} onClick={() => setOpen((current) => !current)} aria-label={`알림${unreadTasks.length ? `, 미확인 ${unreadTasks.length}건` : ""}`} title="알림" aria-expanded={open} aria-haspopup="dialog" aria-controls="task-notification-popover">
      <Bell size={17} strokeWidth={2} />
      {unreadTasks.length > 0 && <span className="notification-count">{unreadTasks.length > 99 ? "99+" : unreadTasks.length}</span>}
    </button>
    {open && <section id="task-notification-popover" className="notification-popover" role="dialog" aria-label="업무 알림">
      <header><div><strong>알림</strong><span>최근 24시간 신규 업무</span></div>{unreadTasks.length > 0 && <button type="button" onClick={() => acknowledge(newTasks.map((task) => task.id))}>모두 확인</button>}</header>
      <div className="notification-list">
        {!loaded ? <div className="notification-empty"><Bell size={19} /><strong>업무 알림을 준비 중입니다</strong><span>업무 데이터를 불러오면 여기에 표시됩니다.</span></div> : !timestampsAvailable ? <div className="notification-empty is-warning"><AlertCircle size={19} /><strong>알림 서버 업데이트가 필요합니다</strong><span>등록 시각이 없어 신규 업무를 구분할 수 없습니다.</span></div> : newTasks.length === 0 ? <div className="notification-empty"><Check size={19} /><strong>새 알림이 없습니다</strong><span>24시간 이내 등록된 업무가 없습니다.</span></div> : newTasks.map((task) => {
          const unread = unreadTasks.some((item) => item.id === task.id);
          return <button type="button" key={task.id} className={`notification-item${unread ? " is-unread" : ""}`} onClick={() => openTask(task)}>
            <span className="notification-item-mark" aria-hidden="true" />
            <span><strong>{task.title}</strong><small>{notificationTime(task.createdAt)} · {task.status || "상태 미지정"}</small></span>
            {unread && <em>신규</em>}
          </button>;
        })}
      </div>
      <footer>알림 확인 상태는 현재 브라우저 탭에만 저장됩니다.</footer>
    </section>}
  </div>;
}

export function Topbar({ project, activeView, actor, onLogout, live, search, setSearch, notificationTasks, notificationsLoaded, onNotificationSelect }) {
  const workspaceMode = activeView === "portfolio";
  return <header className="topbar"><div className="topbar-leading"><div className={`topbar-project-context${workspaceMode ? " is-workspace" : ""}`}><small>{workspaceMode ? "전체 프로젝트" : project.clientName}</small><strong title={workspaceMode ? "통합 관리" : project.name}>{workspaceMode ? "통합 관리" : project.name}</strong></div></div><div className="topbar-actions">{!workspaceMode && <><label className="global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="업무 검색" /></label><TaskNotificationCenter projectId={project.id} tasks={notificationTasks} loaded={notificationsLoaded} onSelect={onNotificationSelect} /></>}<ActorBadge actor={actor} onLogout={onLogout} live={live} /></div></header>;
}

function ProjectCreateModal({ onClose, onSubmit }) {
  const [fields, setFields] = useState({ client_name: "", project_name: "", description: "", start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    globalThis.addEventListener?.("keydown", closeOnEscape);
    return () => globalThis.removeEventListener?.("keydown", closeOnEscape);
  }, [onClose, saving]);

  const submit = async (event) => {
    event.preventDefault();
    if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) {
      setError(new Error("종료일은 시작일보다 빠를 수 없습니다."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(fields);
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="create-modal project-create-modal" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
      <header><div><p className="editorial-kicker">새 운영 공간</p><h2 id="project-create-title">프로젝트 추가</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header>
      <form onSubmit={submit}>
        <label className="create-field"><span>프로젝트 회사</span><input autoFocus required maxLength={120} value={fields.client_name} disabled={saving} onChange={(event) => setField("client_name", event.target.value)} placeholder="예: 새 고객사" /></label>
        <label className="create-field"><span>프로젝트명</span><input required maxLength={200} value={fields.project_name} disabled={saving} onChange={(event) => setField("project_name", event.target.value)} placeholder="예: 통합 마케팅 운영" /></label>
        <label className="create-field"><span>시작일</span><input type="date" value={fields.start_date} max={fields.end_date || undefined} disabled={saving} onChange={(event) => setField("start_date", event.target.value)} /></label>
        <label className="create-field"><span>종료일</span><input type="date" value={fields.end_date} min={fields.start_date || undefined} disabled={saving} onChange={(event) => setField("end_date", event.target.value)} /></label>
        <label className="create-field is-wide"><span>프로젝트 설명</span><textarea rows="3" maxLength={5000} value={fields.description} disabled={saving} onChange={(event) => setField("description", event.target.value)} placeholder="운영 목표나 범위를 입력하세요" /></label>
        <div className="project-create-note"><ShieldCheck size={16} /><span>생성자는 이 프로젝트의 편집 권한을 자동으로 받습니다. 고객 공개는 기본적으로 꺼집니다.</span></div>
        {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "프로젝트를 생성하지 못했습니다."}</span></div>}
        <footer><p>회사와 프로젝트가 하나의 운영 단위로 생성됩니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.client_name.trim() || !fields.project_name.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> 생성 중</> : "프로젝트 생성"}</button></div></footer>
      </form>
    </section>
  </div>;
}


function CampaignWorkspaceHeader({ clients, activeClient, onSelectClient, project, role, activeView, activePlanVariant, onView, actor, onLogout, live, search, setSearch, connectionReady, sourceState }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const visiblePlanChildren = role === "client" ? [PLAN_VARIANTS.client] : Object.values(PLAN_VARIANTS);
  const visibleNavItems = navItems.filter((item) => {
    if (item.accessManagerOnly) return canManageClientAccess(role);
    if (role !== "client") return true;
    return isViewAllowed(item.id, project.allowedPages);
  });
  const activePage = visibleNavItems.find((item) => item.id === activeView);
  const activeLabel = activeView === "plan"
    ? `${activePage?.label || "실행계획"} · ${PLAN_VARIANTS[activePlanVariant]?.label || ""}`
    : activePage?.label || "총괄 현황";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectView = (nextView, nextPlanVariant = activePlanVariant) => {
    onView(nextView, nextPlanVariant);
    setMenuOpen(false);
  };

  return <header className="campaign-workspace-header">
    <div className="campaign-brandbar">
      <div className="campaign-brand"><span className="campaign-brand-mark" aria-hidden="true" /><strong>POCKET COMPANY</strong><i /><span>마케팅 프로젝트 허브</span></div>
      <nav className="campaign-client-tabs" aria-label="고객사 선택">{clients.map((client) => <button key={client.id} type="button" className={client.id === activeClient ? "is-active" : ""} aria-selected={client.id === activeClient} onClick={() => onSelectClient(client.id)}><span>{client.name}</span><i className={`presence ${client.status}`} /></button>)}</nav>
      <div className="campaign-brand-actions"><span className={`campaign-connection ${connectionReady ? "is-online" : ""}`}><i />{connectionReady ? "Sheets 연결" : "연결 확인"}</span><ActorBadge actor={actor} onLogout={onLogout} live={live} /></div>
    </div>
    <div className="campaign-project-header">
      <div className="campaign-project-menu" ref={menuRef}>
        <p className="campaign-project-kicker">CAMPAIGN OPERATIONS</p>
        <button type="button" className="campaign-project-trigger" onClick={() => setMenuOpen((current) => !current)} aria-expanded={menuOpen} aria-haspopup="menu">
          <span><strong>{project.name}</strong><small>{activeLabel}</small></span><ChevronDown size={19} />
        </button>
        {menuOpen && <div className="campaign-project-popover" role="menu">
          <div className="campaign-project-popover-head"><div><span>{project.clientName}</span><strong>{project.name}</strong></div><span className="project-status"><CircleDot size={12} />{project.status}</span></div>
          <div className="campaign-project-pages">{visibleNavItems.map((item) => {
            const Icon = item.icon;
            const itemActive = activeView === item.id || (item.id === "tasks" && activeView === "schedule") || (item.id === "tasks" && activeView === "progress");
            return <article key={item.id} className={`${itemActive ? "is-active" : ""} ${item.id === "plan" ? "is-plan" : ""}`}>
              <button type="button" role="menuitem" onClick={() => selectView(item.id, item.id === "plan" ? DEFAULT_PLAN_VARIANT : activePlanVariant)}><span className="campaign-page-icon"><Icon size={17} /></span><span><strong>{item.label}</strong><small>{item.description || (item.id === "schedule" ? "업무 일정과 간트 보기" : "프로젝트 운영 화면")}</small></span>{itemActive && <Check size={14} />}</button>
              {item.id === "plan" && <div className="campaign-plan-shortcuts">{visiblePlanChildren.map((child) => <button key={child.id} type="button" className={activeView === "plan" && activePlanVariant === child.id ? "is-active" : ""} onClick={() => selectView("plan", child.id)}>{child.label}</button>)}</div>}
            </article>;
          })}</div>
          <footer><span>{connectionReady ? "최신 데이터 사용 중" : "데이터 연결 확인 중"}</span><time>{formatSyncTime(sourceState.lastSuccessfulAt)}</time></footer>
        </div>}
      </div>
      <div className="campaign-project-meta"><span><small>Client</small><strong>{project.clientName}</strong></span><span><small>Campaign period</small><strong>{project.period || `${project.startDate || "-"} — ${project.endDate || "-"}`}</strong></span><span><small>현재 단계</small><strong>{project.phase || "-"}</strong></span></div>
      <div className="campaign-header-tools"><label className="global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="업무 검색" /></label></div>
    </div>
  </header>;
}

function MetricCard({ metric, onOpen }) {
  return <button className={`metric-card tone-${metric.tone}`} onClick={onOpen}><div className="metric-topline"><span>{metric.label}</span><ArrowRight size={14} /></div><strong>{metric.value}</strong><small>{metric.helper}</small><ProgressBar value={metric.progress} color={`var(--tone-${metric.tone})`} /></button>;
}

function OverviewView({ project, role, activities, onNavigate }) {
  const isClient = role === "client";
  return (
    <div className="view-stack">
      <section className="project-hero"><div><p className="editorial-kicker">{project.label}</p><div className="hero-title-row"><h2>{project.name}</h2><span className="project-status"><CircleDot size={13} />{project.status}</span></div><p>{project.objective}</p></div><dl className="hero-meta"><div><dt>현재 단계</dt><dd>{project.phase}</dd></div><div><dt>프로젝트 기간</dt><dd>{project.period}</dd></div><div><dt>최근 업데이트</dt><dd>{project.updatedAt}</dd></div></dl></section>
      <section className="metric-grid" aria-label="핵심 현황">{project.metrics.map((metric, index) => <MetricCard key={metric.label} metric={metric} onOpen={() => onNavigate(index === 2 ? "content" : "tasks")} />)}</section>
      <section className="overview-grid">
        <div className="panel phase-panel"><div className="panel-heading"><div><h3>단계별 업무</h3></div><button className="text-button" onClick={() => onNavigate("tasks")}>업무 전체 보기 <ArrowRight size={14} /></button></div>{project.phases.length ? <div className="phase-timeline">{project.phases.map((phase) => <article key={phase.id} className={phase.state === "current" ? "is-current" : ""}><div className="phase-head"><span>{phase.code}</span><small>{phase.state === "current" ? "현재" : "등록"}</small></div><h4>{phase.label}</h4><div className="phase-stats"><span>업무 {phase.tasks}</span><span>{phase.output}</span></div><ProgressBar value={phase.progress} /></article>)}</div> : <EmptyState title="등록된 단계가 없습니다" description="업무에 단계가 배정되면 자동으로 집계됩니다." />}</div>
        <div className="panel attention-panel"><div className="panel-heading"><div><h3>{isClient ? "이번 주 확인" : "우선 확인할 일"}</h3></div><AlertCircle size={17} /></div>{project.attention.length ? <div className="attention-list">{project.attention.map((item) => <article key={item.id}><div className="attention-title"><span>{item.level}</span><strong>{item.title}</strong></div><p>{item.detail}</p><footer><span>{item.owner}</span><time>{item.due}</time></footer></article>)}</div> : <EmptyState title="확인할 항목이 없습니다" description="승인 대기 항목이 생기면 표시됩니다." />}</div>
      </section>
      <section className="overview-grid lower-grid">
        <div className="panel workstream-panel"><div className="panel-heading"><div><h3>분야별 업무</h3></div><span className="panel-note">원장 등록 기준</span></div>{project.workstreams.length ? <div className="workstream-list">{project.workstreams.map((stream) => <article key={stream.id}><div className="stream-icon" style={{ color: stream.color }}><BarChart3 size={17} /></div><div className="stream-body"><div><strong>{stream.name}</strong><span>{stream.summary}</span></div><ProgressBar value={stream.progress} color={stream.color} /></div><strong className="stream-score">{stream.count}<small>건</small></strong></article>)}</div> : <EmptyState title="분야별 업무가 없습니다" description="업무 분야가 등록되면 집계됩니다." />}</div>
        <div className="panel activity-panel"><div className="panel-heading"><div><h3>최근 업데이트</h3></div><button className="icon-button" onClick={() => onNavigate("files")} aria-label="활동 전체 보기"><MoreHorizontal size={17} /></button></div>{activities.length ? <div className="activity-list">{activities.slice(0, 4).map((item) => <article key={item.id}><span className={`activity-icon type-${item.type}`}>{item.type === "task" ? <Check size={14} /> : item.type === "content" ? <Video size={14} /> : item.type === "schedule" ? <CalendarDays size={14} /> : <BarChart3 size={14} />}</span><div><strong>{item.title}</strong><span>{item.meta}{!isClient && item.internalMeta ? ` · ${item.internalMeta}` : ""}</span></div></article>)}</div> : <EmptyState title="최근 활동이 없습니다" description="원장 변경 이력이 이곳에 표시됩니다." />}</div>
      </section>
    </div>
  );
}

function ViewHeader({ eyebrow, title, description, children }) {
  return <div className="view-header"><div><p className="editorial-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children && <div className="view-actions">{children}</div>}</div>;
}

function CreateButton({ children, entityType, onOpen, enabled }) {
  return <button className="primary-button" onClick={() => onOpen(entityType)} disabled={!enabled} title={enabled ? `${children} 폼 열기` : "운영 데이터 연결에서만 등록할 수 있습니다."}>{children}</button>;
}

const createFormOptions = {
  phase: [["P0", "구축"], ["M1", "운영 1개월차"], ["M2", "운영 2개월차"], ["M3", "운영 3개월차"]],
  stream: [["MKT", "마케팅"], ["DSN", "디자인"], ["VID", "영상"]],
  channel: [["YOUTUBE", "유튜브"], ["INSTAGRAM", "인스타그램"], ["NAVER_BLOG", "네이버 블로그"], ["WEBSITE", "자사몰"]],
  format: [["LONG_FORM", "롱폼"], ["SHORT_FORM", "숏폼"], ["FEED", "피드"], ["REELS", "릴스"], ["ARTICLE", "아티클"]],
};

function FormSelect({ label, value, onChange, options }) {
  return <label className="create-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>;
}

function DisclosureChevron({ expanded, className, size = 16 }) {
  const direction = disclosureChevronDirection(expanded);
  return <span className={`disclosure-chevron ${className || ""}`} data-direction={direction} style={{ "--chevron-size": `${size + 3}px` }} aria-hidden="true">{disclosureChevronGlyph(expanded)}</span>;
}

function CreateRecordModal(props) {
  return ["task", "task-completed"].includes(props.entityType)
    ? <Suspense fallback={<div className="modal-backdrop"><section className="create-modal"><div className="state-panel is-loading"><LoaderCircle className="spin" size={18} /><strong>업무 입력 화면을 준비하고 있습니다.</strong></div></section></div>}><TaskCreateModal {...props} completed={props.entityType === "task-completed"} /></Suspense>
    : <ContentOrFileCreateModal {...props} />;
}

function ContentOrFileCreateModal({ entityType, role, onClose, onSubmit }) {
  const recordType = entityType;
  const [fields, setFields] = useState(() => recordType === "content" ? {
    title: "", channel_code: "INSTAGRAM", format_code: "FEED", status_code: "DRAFT", planned_date: "", visibility_code: "PROJECT_TEAM",
  } : {
    title: "", url: "", file_type_code: "LINK", storage_provider_code: "LINK", visibility_code: "PROJECT_TEAM", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const entityLabel = recordType === "content" ? "콘텐츠" : "자료";
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const cleaned = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
      if (recordType === "content") cleaned.current_version_no = 1;
      await onSubmit(recordType, cleaned);
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-record-title"><header><div><p className="editorial-kicker">운영 데이터 원장 등록</p><h2 id="create-record-title">{entityLabel} 추가</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header><form onSubmit={submit}>
    <label className="create-field is-wide"><span>{entityLabel} 제목</span><input autoFocus required maxLength={200} value={fields.title} onChange={(event) => setField("title", event.target.value)} placeholder={`${entityLabel} 제목을 입력하세요`} /></label>
    {recordType === "content" && <><FormSelect label="채널" value={fields.channel_code} onChange={(value) => setField("channel_code", value)} options={createFormOptions.channel} /><FormSelect label="형식" value={fields.format_code} onChange={(value) => setField("format_code", value)} options={createFormOptions.format} /><FormSelect label="상태" value={fields.status_code} onChange={(value) => setField("status_code", value)} options={[["DRAFT", "초안"], ["PLANNED", "예정"], ["IN_PROGRESS", "제작"]]} /><label className="create-field"><span>예정일</span><input type="date" value={fields.planned_date} onChange={(event) => setField("planned_date", event.target.value)} /></label></>}
    {recordType === "file" && <><label className="create-field is-wide"><span>HTTPS 자료 링크</span><input type="url" required pattern="https://.*" value={fields.url} onChange={(event) => setField("url", event.target.value)} placeholder="https://" /></label><label className="create-field is-wide"><span>메모</span><textarea rows="3" maxLength={1000} value={fields.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="자료 설명 또는 버전을 적어 주세요" /></label></>}
    {role === "pocket" && <FormSelect label="공개 범위" value={fields.visibility_code} onChange={(value) => setField("visibility_code", value)} options={[["PROJECT_TEAM", "프로젝트 팀"], ["CLIENT", "고객 공개"], ["POCKET_ONLY", "포켓 전용"]]} />}
    {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "저장하지 못했습니다."}</span></div>}
    <footer><p>서버 저장 성공 이후에만 목록에 반영됩니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.title.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "원장에 저장"}</button></div></footer>
  </form></section></div>;
}

const trackerPhaseDefinitions = [
  { code: "P0", label: "구축" },
  { code: "M1", label: "운영 1개월차" },
  { code: "M2", label: "운영 2개월차" },
  { code: "M3", label: "운영 3개월차" },
];

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

function editableTaskStatusCode(value) {
  const code = String(value || "NOT_STARTED").toUpperCase();
  if (["DONE", "COMPLETED"].includes(code)) return "DONE";
  if (["ON_HOLD", "BLOCKED"].includes(code)) return "ON_HOLD";
  if (["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(code)) return "IN_PROGRESS";
  return "NOT_STARTED";
}

const trackerPriorityLabels = { LOW: "낮음", NORMAL: "보통", HIGH: "높음", CRITICAL: "긴급", URGENT: "긴급" };

function taskWithMutationFields(task, fields = {}) {
  const next = { ...task };
  const scheduleChanged = ["planned_start_date", "due_date", "schedule_dates_json", "schedule_dates"].some((field) => Object.prototype.hasOwnProperty.call(fields, field));
  if (scheduleChanged) next.statusMode = "SCHEDULE";
  else if (Object.prototype.hasOwnProperty.call(fields, "status_code")) next.statusMode = "MANUAL";
  if (Object.prototype.hasOwnProperty.call(fields, "status_code")) {
    next.statusCode = String(fields.status_code || "NOT_STARTED").toUpperCase();
    next.status = trackerStatusLabels[next.statusCode] || next.statusCode;
  }
  if (Object.prototype.hasOwnProperty.call(fields, "title")) next.title = fields.title || "제목 없는 업무";
  if (Object.prototype.hasOwnProperty.call(fields, "description")) next.description = fields.description || "";
  if (Object.prototype.hasOwnProperty.call(fields, "planned_start_date")) next.plannedStartDate = fields.planned_start_date || null;
  if (Object.prototype.hasOwnProperty.call(fields, "due_date")) {
    next.dueDate = fields.due_date ? String(fields.due_date).slice(0, 10) : null;
    next.due = next.dueDate || "미정";
  }
  if (Object.prototype.hasOwnProperty.call(fields, "priority_code")) {
    next.priorityCode = String(fields.priority_code || "NORMAL").toUpperCase();
    next.priority = trackerPriorityLabels[next.priorityCode] || next.priorityCode;
  }
  if (Object.prototype.hasOwnProperty.call(fields, "progress_percent")) next.progressPercent = Number(fields.progress_percent || 0);
  if (Object.prototype.hasOwnProperty.call(fields, "completion_url")) next.completionUrl = fields.completion_url || "";
  if (Object.prototype.hasOwnProperty.call(fields, "remarks")) next.remarks = fields.remarks || "";
  if (Object.prototype.hasOwnProperty.call(fields, "schedule_dates_json")) {
    next.scheduleDates = normalizeScheduleDates(fields.schedule_dates_json) || [];
  }
  if (Object.prototype.hasOwnProperty.call(fields, "sort_order")) next.sortOrder = Number(fields.sort_order);
  if (Object.prototype.hasOwnProperty.call(fields, "category_code")) next.categoryCode = String(fields.category_code || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(fields, "visibility_code")) next.visibilityCode = String(fields.visibility_code || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(fields, "responsible_org_code")) {
    const organization = taskResponsibleOrganization(fields.responsible_org_code);
    next.responsibleOrgCode = organization.code;
    next.responsibleOrg = organization.label;
  }
  const effectiveState = effectiveTaskScheduleState(next);
  next.statusCode = effectiveState.statusCode;
  next.status = trackerStatusLabels[next.statusCode] || next.statusCode;
  next.progressPercent = effectiveState.progressPercent;
  next.statusAutomatic = effectiveState.automatic;
  return next;
}

function trackerDate(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trackerDateLabel(value) {
  const parsed = value instanceof Date ? value : trackerDate(value);
  if (!parsed) return "미정";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(parsed);
}

function addTrackerDays(value, amount) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function addTrackerMonths(value, amount) {
  const next = new Date(value);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

function trackerForward(value) {
  const next = new Date(value);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

function trackerBack(value) {
  const next = new Date(value);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() - 1);
  return next;
}

function addTrackerBusinessDays(value, businessDays) {
  const next = new Date(value);
  let counted = 0;
  while (counted < businessDays) {
    next.setDate(next.getDate() + 1);
    if (next.getDay() !== 0 && next.getDay() !== 6) counted += 1;
  }
  return next;
}

function trackerSchedule(startDate) {
  const start = trackerDate(startDate);
  if (!start) return trackerPhaseDefinitions.map((phase) => ({ ...phase, start: null, end: null, period: "일정 미정" }));
  const p0Start = trackerForward(start);
  const p0End = addTrackerBusinessDays(p0Start, 14);
  const ranges = [{ start: p0Start, end: p0End }];
  let cursor = addTrackerBusinessDays(p0End, 1);
  for (let index = 0; index < 3; index += 1) {
    const monthStart = trackerForward(cursor);
    const monthEnd = trackerBack(addTrackerDays(addTrackerMonths(monthStart, 1), -1));
    ranges.push({ start: monthStart, end: monthEnd });
    cursor = addTrackerDays(monthEnd, 1);
  }
  return trackerPhaseDefinitions.map((phase, index) => ({
    ...phase,
    ...ranges[index],
    period: `${trackerDateLabel(ranges[index].start)} — ${trackerDateLabel(ranges[index].end)}`,
  }));
}

function trackerCurrentSchedule(schedule, startDate, fallbackPhaseCode, referenceDate = new Date()) {
  if (trackerDate(startDate)) {
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    const dated = schedule.filter((item) => item.start && item.end);
    return dated.find((item) => today.getTime() <= item.end.getTime()) || dated[dated.length - 1] || null;
  }
  return schedule.find((item) => item.code === fallbackPhaseCode) || null;
}

function trackerTaskDue(task, schedule) {
  const explicit = trackerDate(task.dueDate);
  if (explicit) return explicit;
  const phase = schedule.find((item) => item.code === task.phaseCode);
  if (!phase?.start || !phase.end || !task.planWeek) return null;
  if (task.phaseCode === "P0") return addTrackerBusinessDays(phase.start, task.planWeek * 5 - 1);
  if (task.planWeek >= 5) return addTrackerBusinessDays(phase.end, 5);
  let due = addTrackerDays(phase.start, task.planWeek * 7 - 1);
  if (due.getTime() > phase.end.getTime()) due = new Date(phase.end);
  return trackerBack(due);
}

function trackerTaskDueLabel(value) {
  if (!value) return "미정";
  return `${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getDate()).padStart(2, "0")}`;
}

function trackerDdayLabel(value) {
  if (!value) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `D+${Math.abs(days)}`;
  if (days === 0) return "D-DAY";
  return `D-${days}`;
}

function TrackerTaskRow({ task, role, clientName, canWrite, onUpdate, isDone }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(task.title || "");
  const [note, setNote] = useState(task.description || "");
  const [startDate, setStartDate] = useState(task.plannedStartDate || "");
  const [responsibleOrg, setResponsibleOrg] = useState(task.responsibleOrgCode || "POCKET");
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [progressPercent, setProgressPercent] = useState(task.progressPercent ?? 0);
  const [completionUrl, setCompletionUrl] = useState(task.completionUrl || "");
  const [remarks, setRemarks] = useState(task.remarks || "");
  const [priority, setPriority] = useState(task.priorityCode || "NORMAL");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setTitle(task.title || ""), [task.title]);
  useEffect(() => setNote(task.description || ""), [task.description]);
  useEffect(() => setStartDate(task.plannedStartDate || ""), [task.plannedStartDate]);
  useEffect(() => setResponsibleOrg(task.responsibleOrgCode || "POCKET"), [task.responsibleOrgCode]);
  useEffect(() => setDueDate(task.dueDate || ""), [task.dueDate]);
  useEffect(() => setProgressPercent(task.progressPercent ?? 0), [task.progressPercent]);
  useEffect(() => setCompletionUrl(task.completionUrl || ""), [task.completionUrl]);
  useEffect(() => setRemarks(task.remarks || ""), [task.remarks]);
  useEffect(() => setPriority(task.priorityCode || "NORMAL"), [task.priorityCode]);

  const saveFields = async (fields) => {
    if (!canWrite || !onUpdate) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate(task, fields);
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = (event) => {
    event.stopPropagation();
    if (!canWrite || saving) return;
    saveFields({ status_code: isDone ? "NOT_STARTED" : "DONE" });
  };

  return <article className={`${isDone ? "is-done" : ""} ${expanded ? "is-expanded" : ""} ${saving ? "is-saving" : ""}`}>
    <div className="tracker-task-main" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded((current) => !current); } }}>
      <button className="tracker-check" type="button" onClick={toggleDone} disabled={!canWrite || saving} aria-label={isDone ? `${task.title} 완료 취소` : `${task.title} 완료 처리`}>{isDone && <Check size={13} strokeWidth={2.5} />}</button>
      <div className="tracker-task-copy"><strong>{task.title}</strong></div>
      <div className="tracker-task-state"><i className={statusClass[task.status] || "status status-muted"}>{task.status}</i>{saving && <span className="tracker-row-saving" role="status"><LoaderCircle size={11} className="spin" />저장 중</span>}</div>
      <DisclosureChevron expanded={expanded} className="tracker-row-chevron" size={16} />
      <div className="tracker-task-meta">
        <span><small>구분</small><strong>{task.parent}{task.planWeek ? ` · ${task.planWeek}주차` : ""}{task.contractLinked ? " · 계획 연계" : ""}</strong></span>
        <span><small>담당</small><strong>{role === "client" ? "포켓컴퍼니" : taskResponsibleOrgLabel(task.responsibleOrgCode, clientName)}</strong></span>
        <span><small>마감</small><strong>{task.due}</strong></span>
      </div>
    </div>
    {error && !expanded && <div className="tracker-row-error" role="alert"><AlertCircle size={13} /><span>{error.message || "변경사항을 저장하지 못해 이전 상태로 되돌렸습니다."}</span><button type="button" onClick={() => setError(null)} aria-label="오류 닫기"><X size={12} /></button></div>}
    {expanded && <div className="tracker-task-detail">
      {role !== "client" && task.planNote && <div className="tracker-plan-note"><strong>계획 기준</strong><p>{task.planNote}</p></div>}
      {role === "client" && task.customerStatus && <div className="tracker-client-status"><strong>공유 진행 메모</strong><p>{task.customerStatus}</p></div>}
      {canWrite && <div className="tracker-task-edit">
        <div><span>상태</span><div className="tracker-status-actions">{trackerStatusOptions.map(([code, label]) => <button key={code} type="button" disabled={!canWrite || saving} className={task.statusCode === code || (code === "DONE" && task.statusCode === "COMPLETED") ? "is-active" : ""} onClick={() => saveFields({ status_code: code })}>{label}</button>)}</div></div>
        <label className="tracker-owner-edit"><span>업무명</span><input value={title} disabled={saving} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="tracker-owner-edit"><span>시작일</span><input type="date" value={startDate} disabled={saving} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="tracker-owner-edit"><span>종료일</span><input type="date" value={dueDate} disabled={saving} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label className="tracker-owner-edit"><span>진행률 (%)</span><input type="number" min="0" max="100" value={progressPercent} disabled={saving} onChange={(event) => setProgressPercent(event.target.value)} /></label>
        <label className="tracker-owner-edit"><span>우선순위</span><select value={priority} disabled={saving} onChange={(event) => setPriority(event.target.value)}><option value="LOW">낮음</option><option value="NORMAL">보통</option><option value="HIGH">높음</option><option value="CRITICAL">긴급</option></select></label>
        <label className="tracker-owner-edit"><span>담당</span><select value={responsibleOrg} disabled={!canWrite || saving} onChange={(event) => setResponsibleOrg(event.target.value)}>{taskResponsibleOrgOptions(clientName).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <label><span>세부내용</span><textarea rows="3" value={note} disabled={!canWrite || saving} onChange={(event) => setNote(event.target.value)} placeholder="업무 범위와 산출물을 적어 주세요" /></label>
        <label><span>완료링크</span><input type="url" pattern="https://.*" value={completionUrl} disabled={!canWrite || saving} onChange={(event) => setCompletionUrl(event.target.value)} placeholder="https://" /></label>
        <label><span>비고</span><textarea rows="2" value={remarks} disabled={!canWrite || saving} onChange={(event) => setRemarks(event.target.value)} placeholder="일정 이슈나 참고사항을 적어 주세요" /></label>
        <div className="tracker-edit-footer">{error ? <span className="tracker-save-error"><AlertCircle size={14} />{error.message || "저장하지 못했습니다."}</span> : <span>저장 시 Supabase 업무 원장에 즉시 반영됩니다.</span>}<button className="primary-button" type="button" disabled={saving || !title.trim() || (title === (task.title || "") && note === (task.description || "") && startDate === (task.plannedStartDate || "") && responsibleOrg === (task.responsibleOrgCode || "POCKET") && dueDate === (task.dueDate || "") && Number(progressPercent) === Number(task.progressPercent ?? 0) && completionUrl === (task.completionUrl || "") && remarks === (task.remarks || "") && priority === (task.priorityCode || "NORMAL"))} onClick={() => { const fields = { title, description: note, planned_start_date: startDate, due_date: dueDate, progress_percent: Number(progressPercent), completion_url: completionUrl, remarks, priority_code: priority }; if (responsibleOrg !== (task.responsibleOrgCode || "POCKET")) fields.responsible_org_code = responsibleOrg; saveFields(fields); }}>{saving ? <><LoaderCircle size={14} className="spin" /> 저장 중</> : "변경 저장"}</button></div>
      </div>}
    </div>}
  </article>;
}

function TaskEditModal({ task, clientName, onClose, onUpdate }) {
  const [fields, setFields] = useState(() => taskUpdateInitialFields(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    globalThis.addEventListener?.("keydown", closeOnEscape);
    return () => globalThis.removeEventListener?.("keydown", closeOnEscape);
  }, [onClose, saving]);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onUpdate(task, taskUpdateSubmissionFields(fields));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="create-modal task-edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-edit-title">
      <header><div><p className="editorial-kicker">프로젝트 일정표</p><h2 id="task-edit-title">업무 수정</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header>
      <form onSubmit={submit}>
        <label className="create-field is-wide"><span>업무명</span><input autoFocus required maxLength={200} value={fields.title} disabled={saving} onChange={(event) => setField("title", event.target.value)} /></label>
        <div className="create-field is-wide task-edit-status"><span>상태</span><div className="tracker-status-actions">{trackerStatusOptions.map(([code, label]) => <button key={code} type="button" disabled={saving} className={fields.status_code === code ? "is-active" : ""} onClick={() => setField("status_code", code)}>{label}</button>)}</div></div>
        <label className="create-field"><span>시작일</span><input type="date" value={fields.planned_start_date} max={fields.due_date || undefined} disabled={saving} onChange={(event) => setField("planned_start_date", event.target.value)} /></label>
        <label className="create-field"><span>종료일</span><input type="date" value={fields.due_date} min={fields.planned_start_date || undefined} disabled={saving} onChange={(event) => setField("due_date", event.target.value)} /></label>
        <label className="create-field"><span>진행률 (%)</span><input type="number" min="0" max="100" value={fields.progress_percent} disabled={saving} onChange={(event) => setField("progress_percent", event.target.value)} /></label>
        <FormSelect label="우선순위" value={fields.priority_code} onChange={(value) => setField("priority_code", value)} options={[["LOW", "낮음"], ["NORMAL", "보통"], ["HIGH", "높음"], ["CRITICAL", "긴급"]]} />
        <FormSelect label="담당" value={fields.responsible_org_code} onChange={(value) => setField("responsible_org_code", value)} options={taskResponsibleOrgOptions(clientName)} />
        <label className="create-field is-wide"><span>세부내용</span><textarea rows="3" maxLength={10000} value={fields.description} disabled={saving} onChange={(event) => setField("description", event.target.value)} /></label>
        <label className="create-field is-wide"><span>완료링크</span><input type="url" pattern="https://.*" value={fields.completion_url} disabled={saving} onChange={(event) => setField("completion_url", event.target.value)} placeholder="https://" /></label>
        <label className="create-field is-wide"><span>비고</span><textarea rows="2" maxLength={10000} value={fields.remarks} disabled={saving} onChange={(event) => setField("remarks", event.target.value)} /></label>
        {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "업무를 저장하지 못했습니다."}</span></div>}
        <footer><p>저장하면 Supabase 업무 원장과 업무 로그에 반영됩니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.title.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "변경 저장"}</button></div></footer>
      </form>
    </section>
  </div>;
}

function taskActivityValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const taskActivityDateFilters = [
  ["ALL", "전체"],
  ["TODAY", "오늘"],
  ["YESTERDAY", "어제"],
  ["LAST_7_DAYS", "최근 7일"],
];

function taskActivityDateLabel(value) {
  if (value === "날짜 미상") return value;
  const today = taskActivityDateKey(new Date());
  const date = new Date(`${value}T00:00:00+09:00`);
  const label = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(date);
  return value === today ? `오늘 · ${label}` : label;
}

function TaskActivityLog({ state, tasks, clientName, onRefresh, onLoadMore }) {
  const data = state?.data || null;
  const items = useMemo(() => readableTaskActivities(data?.items || [], tasks || []), [data?.items, tasks]);
  const [dateFilter, setDateFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const filteredItems = useMemo(() => filterTaskActivities(items, { dateFilter, ownerFilter }), [items, dateFilter, ownerFilter]);
  const groups = useMemo(() => groupTaskActivitiesByDate(filteredItems), [filteredItems]);
  const ownerOptions = useMemo(() => [["ALL", "전체"], ...taskResponsibleOrgOptions(clientName)], [clientName]);
  const loading = state?.status === "loading";
  const loadingMore = state?.loadingMore === true;

  return <section className="task-change-log is-embedded" aria-label="업무 로그" aria-busy={loading}>
    {loading && !data ? <LoadingState label="업무 로그를 불러오는 중입니다." /> : state?.status === "error" && !data ? <ErrorState error={state.error} onRetry={onRefresh} title="업무 로그를 불러오지 못했습니다." /> : <>
      {state?.status === "error" && data && <div className="task-change-log-warning" role="alert"><AlertCircle size={14} />{state.error?.message || "새로고침하지 못해 이전 로그를 표시합니다."}</div>}
      {items.length > 0 && <div className="task-activity-filters" aria-label="업무 로그 필터">
        <div className="task-activity-filter-group"><strong>일자별</strong><div>{taskActivityDateFilters.map(([value, label]) => <button type="button" key={value} className={dateFilter === value ? "is-active" : ""} aria-pressed={dateFilter === value} onClick={() => setDateFilter(value)}>{label}</button>)}</div></div>
        <div className="task-activity-filter-group"><strong>담당별</strong><div>{ownerOptions.map(([value, label]) => <button type="button" key={value} className={ownerFilter === value ? "is-active" : ""} aria-pressed={ownerFilter === value} onClick={() => setOwnerFilter(value)}>{label}</button>)}</div></div>
        <span>{filteredItems.length}건</span>
      </div>}
      {groups.length ? <div className="task-change-log-list">{groups.map((group) => <section className="task-change-log-day" key={group.date}><header><strong>{taskActivityDateLabel(group.date)}</strong><span>{group.items.length}건</span></header>{group.items.map((item) => <article key={item.id} className="task-change-log-row">
      <time dateTime={item.createdAt || undefined}>{formatSyncTime(item.createdAt)}</time>
      <div className="task-change-log-task"><strong>{item.taskTitle}</strong></div>
      <span className={`task-change-log-action is-${String(item.actionCode || "changed").toLowerCase()}`}>{item.action}</span>
      <div className="task-change-log-changes">{item.changes.length ? item.changes.map((change) => <div key={`${item.id}-${change.field}`}><strong>{change.label}</strong><span>{taskActivityValue(change.before)}</span><ArrowRight size={12} /><em>{taskActivityValue(change.after)}</em></div>) : <span className="task-change-log-no-detail">{taskActivitySentence(item)}</span>}</div>
      <div className="task-change-log-actor"><small>변경자</small><strong>{item.actor}</strong></div>
      </article>)}</section>)}</div> : <EmptyState title={items.length ? "조건에 맞는 업무 로그가 없습니다" : "업무 로그가 없습니다"} description={items.length ? "일자 또는 담당 필터를 변경해 주세요." : "웹에서 업무를 생성하거나 수정하면 확정된 이력이 표시됩니다."} />}
      {data?.nextCursor && <div className="task-activity-load-more"><button className="btn" type="button" disabled={loadingMore} onClick={() => onLoadMore?.(data.nextCursor)}>{loadingMore ? <LoaderCircle size={13} className="spin" /> : <History size={13} />}{loadingMore ? "이전 로그 불러오는 중" : "이전 로그 더 보기"}</button><small>로그는 삭제하지 않고 계속 누적 저장됩니다.</small></div>}
    </>}
  </section>;
}

function taskDurationDays(startValue, endValue) {
  const start = trackerDate(startValue);
  const end = trackerDate(endValue);
  if (!start || !end || end < start) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function taskInlineDraft(task = {}, displayedStart, displayedEnd) {
  return {
    title: task.title || "",
    description: task.description || "",
    planned_start_date: displayedStart || task.plannedStartDate || "",
    due_date: displayedEnd || task.dueDate || "",
    progress_percent: task.progressPercent ?? 0,
    status_code: editableTaskStatusCode(task.statusCode),
    responsible_org_code: task.responsibleOrgCode || "POCKET",
    completion_url: task.completionUrl || "",
    remarks: task.remarks || "",
  };
}

function validInlineTaskUrl(value) {
  return !String(value || "").trim() || /^https?:\/\/[^\s]+$/i.test(String(value).trim());
}

function compactTaskDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${Number(match[2])}.${Number(match[3])}` : "–";
}

function CompactTaskDateInput({ label, value, min, max, readOnly, disabled, onChange }) {
  const openPicker = (event) => {
    const input = event.currentTarget;
    if (readOnly || disabled || typeof input.showPicker !== "function") return;
    try { input.showPicker(); event.preventDefault(); } catch { /* Keep the native picker fallback. */ }
  };
  return <label className={`task-inline-date-compact${readOnly ? " is-readonly" : ""}`} title={value || label}>
    <span className="task-inline-date-display" aria-hidden="true">{compactTaskDateLabel(value)}</span>
    <CalendarDays size={11} aria-hidden="true" />
    <input className="task-inline-date" type="date" aria-label={label} value={value} min={min} max={max} readOnly={readOnly} disabled={disabled} onClick={openPicker} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPicker(event); }} onChange={onChange} />
  </label>;
}

function TaskRowActions({ task, onEdit, onArchive, disabled = false, compact = false }) {
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deleteArmed) return undefined;
    const timer = globalThis.setTimeout?.(() => setDeleteArmed(false), 5000);
    return () => globalThis.clearTimeout?.(timer);
  }, [deleteArmed]);

  const requestArchive = async () => {
    if (disabled || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setError("");
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onArchive(task);
    } catch (archiveError) {
      setDeleteArmed(false);
      setError(archiveError?.message || "업무를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  return <div className={`task-row-actions${compact ? " is-compact" : ""}${deleteArmed ? " is-delete-armed" : ""}`}>
    <button type="button" className="task-action-edit" disabled={disabled || deleting} onClick={() => onEdit(task.id)} aria-label={`${task.title} 수정`} title="업무 수정"><Pencil size={13} /></button>
    <button type="button" className="task-action-delete" disabled={disabled || deleting} onClick={() => void requestArchive()} aria-label={deleteArmed ? `${task.title} 삭제 확인` : `${task.title} 삭제`} title={deleteArmed ? "한 번 더 눌러 삭제" : "업무 삭제"}>{deleting ? <LoaderCircle size={13} className="spin" /> : deleteArmed ? <span>삭제?</span> : <Trash2 size={13} />}</button>
    {error && <small className="task-row-action-error" role="alert" title={error}>{error}</small>}
  </div>;
}

function TaskScheduleInlineRow({ task, project, canWrite, onUpdate, onEdit, onArchive, displayedStart, displayedEnd, newTask, rowClass, mediaColor, mediaGroupStart, selected, onSelect, reorderEnabled, dragging, dropPosition, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const [draft, setDraft] = useState(() => taskInlineDraft(task, displayedStart, displayedEnd));
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
    if (!savingField) setDraft(taskInlineDraft(task, displayedStart, displayedEnd));
  }, [task, displayedStart, displayedEnd, savingField]);

  const setField = (field, value) => {
    setSaveError("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const commitField = async (field, rawValue) => {
    if (!canWrite || !onUpdate || savingField) return;
    const baseTask = taskRef.current;
    const baseDraft = taskInlineDraft(baseTask, baseTask.plannedStartDate, baseTask.dueDate);
    let value = rawValue;
    if (["title", "completion_url"].includes(field)) value = String(rawValue || "").trim();
    if (field === "progress_percent") {
      value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        setSaveError("진행률은 0~100 사이로 입력해 주세요.");
        setDraft((current) => ({ ...current, progress_percent: baseDraft.progress_percent }));
        return;
      }
    }
    if (field === "title" && !value) {
      setSaveError("업무명은 비워둘 수 없습니다.");
      setDraft((current) => ({ ...current, title: baseDraft.title }));
      return;
    }
    if (field === "completion_url" && !validInlineTaskUrl(value)) {
      setSaveError("완료링크는 http:// 또는 https:// 주소로 입력해 주세요.");
      return;
    }

    const dateRangeField = field === "date_range";
    let nextDraft = dateRangeField ? { ...draft } : { ...draft, [field]: value };
    let fields = dateRangeField ? {} : { [field]: value };
    if (field === "status_code") {
      fields = taskStatusMutationFields(value, baseTask);
      nextDraft = { ...nextDraft, ...fields };
    }
    if (field === "progress_percent" && value < 100 && ["DONE", "COMPLETED"].includes(baseTask.statusCode)) {
      fields.status_code = "IN_PROGRESS";
      nextDraft.status_code = "IN_PROGRESS";
    }
    if (dateRangeField || field === "planned_start_date" || field === "due_date") {
      const start = String(nextDraft.planned_start_date || "");
      const end = String(nextDraft.due_date || "");
      if (start && end && end < start) {
        setSaveError("종료일은 시작일보다 빠를 수 없습니다.");
        return;
      }
      fields = {
        planned_start_date: start,
        due_date: end,
        schedule_dates_json: start && end ? serializeScheduleDates(scheduleDateRange(start, end)) : null,
      };
    }
    const unchanged = Object.entries(fields).every(([key, fieldValue]) => {
      if (key === "schedule_dates_json") return true;
      return String(baseDraft[key] ?? "") === String(fieldValue ?? "");
    });
    if (unchanged) return;

    setDraft(nextDraft);
    setSavingField(field);
    setSaveError("");
    try {
      const savedTask = await onUpdate(baseTask, fields);
      if (savedTask) {
        taskRef.current = savedTask;
        setDraft(taskInlineDraft(savedTask, savedTask.plannedStartDate, savedTask.dueDate));
      }
    } catch (error) {
      setDraft(taskInlineDraft(baseTask, baseTask.plannedStartDate, baseTask.dueDate));
      setSaveError(error?.code === "conflict" ? "다른 사용자의 변경사항을 먼저 다시 불러와 주세요." : error?.message || "저장하지 못했습니다.");
    } finally {
      setSavingField("");
    }
  };

  const commitOnEnter = (event, field) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(taskInlineDraft(taskRef.current, taskRef.current.plannedStartDate, taskRef.current.dueDate));
      event.currentTarget.blur();
    }
  };

  const duration = taskDurationDays(draft.planned_start_date, draft.due_date);
  const statusLabel = trackerStatusLabels[draft.status_code] || draft.status_code;
  const media = taskScheduleMedia(task);
  const progress = Math.max(0, Math.min(100, Number(draft.progress_percent) || 0));
  const disabled = !canWrite || Boolean(savingField);
  const customerHidden = taskHiddenFromClient(task);

  return <tr className={`task-schedule-row reference-task-row ${rowClass}${mediaGroupStart ? " is-media-group-start" : ""}${newTask ? " is-new-task" : ""}${savingField ? " is-saving" : ""}${saveError ? " has-save-error" : ""}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}${dropPosition ? ` is-drop-${dropPosition}` : ""}`} style={{ "--media-color": mediaColor }} onDragOver={(event) => onDragOver?.(event, task.id)} onDrop={(event) => { if (!reorderEnabled) return; event.preventDefault(); onDrop?.(task.id); }}>
    {canWrite && <td className="reference-task-select"><div className="reference-task-cell"><input type="checkbox" checked={selected} onChange={(event) => onSelect?.(task.id, event.target.checked, { shiftKey: event.nativeEvent?.shiftKey || event.shiftKey })} aria-label={`${task.title} 선택`} /></div></td>}
    <td className="reference-task-media" aria-label={media}><div className="reference-task-cell"><span><i aria-hidden="true" />{media}</span></div></td>
    <td className="reference-task-workstream"><div className="reference-task-cell">{taskScheduleCategory(task)}</div></td>
    <td className="reference-task-name"><div className="reference-task-cell">{canWrite && <span className="task-reorder-handle" draggable={reorderEnabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); onDragStart?.(task.id); }} onDragEnd={onDragEnd} aria-label={`${task.title} 순서 이동`} title={reorderEnabled ? "끌어서 업무 순서 이동" : "필터를 해제하면 순서를 이동할 수 있습니다"}><GripVertical size={14} /><small>이동</small></span>}<input className="task-inline-input task-name" aria-label={`${task.title} 업무명`} maxLength={500} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.title} onChange={(event) => setField("title", event.target.value)} onBlur={(event) => void commitField("title", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "title")} />{newTask && <em className="task-new-badge">신규</em>}{customerHidden && <em className="task-client-hidden-badge" title="고객사 계정에는 표시되지 않습니다"><LockKeyhole size={9} />고객 숨김</em>}{saveError && <small className="task-inline-error" role="alert">{saveError}</small>}</div></td>
    <td className="reference-task-detail"><div className="reference-task-cell"><textarea className="task-inline-textarea" aria-label={`${task.title} 세부내용`} rows="1" maxLength={20000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.description} placeholder={canWrite ? "세부내용" : ""} onChange={(event) => setField("description", event.target.value)} onBlur={(event) => void commitField("description", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "description")} /></div></td>
    <td className="reference-task-dates"><div className="reference-task-cell task-inline-date-range" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void commitField("date_range"); }}><CompactTaskDateInput label={`${task.title} 시작일`} readOnly={!canWrite} disabled={disabled} value={draft.planned_start_date} max={draft.due_date || undefined} onChange={(event) => setField("planned_start_date", event.target.value)} /><ArrowRight size={10} aria-hidden="true" /><CompactTaskDateInput label={`${task.title} 종료일`} readOnly={!canWrite} disabled={disabled} value={draft.due_date} min={draft.planned_start_date || undefined} onChange={(event) => setField("due_date", event.target.value)} /></div></td>
    <td className="reference-task-duration"><div className="reference-task-cell">{duration === null ? "–" : `${duration}일`}</div></td>
    <td className="reference-task-progress"><div className="reference-task-cell"><span className="task-inline-progress"><span><i style={{ width: `${progress}%` }} /></span><input type="number" min="0" max="100" aria-label={`${task.title} 진행률`} readOnly={!canWrite} disabled={disabled} value={draft.progress_percent} onChange={(event) => setField("progress_percent", event.target.value)} onBlur={(event) => void commitField("progress_percent", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "progress_percent")} /><em>%</em></span></div></td>
    <td className="reference-task-status"><div className="reference-task-cell"><select className={`task-inline-select task-inline-status ${statusClass[statusLabel] || "status status-muted"}`} disabled={disabled} data-status-code={draft.status_code} aria-label={`${task.title} 상태`} value={draft.status_code} onChange={(event) => { const next = event.target.value; setField("status_code", next); void commitField("status_code", next); }}>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></div></td>
    <td className="reference-task-owner"><div className="reference-task-cell"><select className={`task-inline-select task-inline-owner is-${String(draft.responsible_org_code || "POCKET").toLowerCase()}`} disabled={disabled} aria-label={`${task.title} 담당`} value={draft.responsible_org_code} onChange={(event) => { const next = event.target.value; setField("responsible_org_code", next); void commitField("responsible_org_code", next); }}>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></div></td>
    <td className="reference-task-link"><div className="reference-task-cell"><span className="task-inline-link">{validInlineTaskUrl(draft.completion_url) && draft.completion_url && <a href={draft.completion_url} target="_blank" rel="noreferrer" aria-label={`${task.title} 완료링크 열기`}>열기 ↗</a>}<input className="task-inline-input" type="text" inputMode="url" aria-label={`${task.title} 완료링크`} maxLength={2048} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.completion_url} placeholder={canWrite ? "https://" : ""} onChange={(event) => setField("completion_url", event.target.value)} onBlur={(event) => void commitField("completion_url", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "completion_url")} /></span></div></td>
    <td className="reference-task-note"><div className="reference-task-cell"><textarea className="task-inline-textarea" aria-label={`${task.title} 비고`} rows="1" maxLength={10000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.remarks} placeholder={canWrite ? "비고" : ""} onChange={(event) => setField("remarks", event.target.value)} onBlur={(event) => void commitField("remarks", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "remarks")} /></div></td>
    {canWrite && <td className="reference-task-actions"><TaskRowActions task={task} onEdit={onEdit} onArchive={onArchive} disabled={Boolean(savingField)} /></td>}
  </tr>;
}

function TaskScheduleInlineTable({ tasks, project, canWrite, onUpdate, onEdit, onArchive, ganttDrafts, freshnessNow, scheduleClass, mediaColor, selectedTaskIds, onSelectTask, onSelectAll, reorderEnabled, draggingTaskIds, dropIndicator, onDragStart, onDragEnd, onDragOverTask, onDropTask }) {
  const columnWidths = [88, 64, null, 200, 126, 44, 92, 54, 54, 105, 135];
  const allSelected = Boolean(canWrite && tasks.length && tasks.every((task) => selectedTaskIds?.has(task.id)));
  let previousMedia = "";
  const bodyRows = [];
  tasks.forEach((task) => {
    const media = taskScheduleMedia(task);
    const mediaKey = media.replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
    const mediaGroupStart = !previousMedia || mediaKey !== previousMedia;
    previousMedia = mediaKey;
    const scheduleDates = ganttDrafts?.get(task.id) || taskScheduleDates(task);
    const bounds = scheduleDateBounds(scheduleDates);
    bodyRows.push(<TaskScheduleInlineRow key={task.id} task={task} project={project} canWrite={canWrite} onUpdate={onUpdate} onEdit={onEdit} onArchive={onArchive} displayedStart={bounds.start || task.plannedStartDate || ""} displayedEnd={bounds.end || task.dueDate || ""} newTask={isNewTask(task, freshnessNow)} rowClass={scheduleClass(task)} mediaColor={mediaColor(media)} mediaGroupStart={mediaGroupStart} selected={selectedTaskIds?.has(task.id)} onSelect={onSelectTask} reorderEnabled={reorderEnabled} dragging={draggingTaskIds?.includes(task.id)} dropPosition={dropIndicator?.taskId === task.id ? dropIndicator.position : ""} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOverTask} onDrop={onDropTask} />);
  });
  return <div className="task-schedule-matrix-scroll reference-task-scroll"><table className={`task-schedule-matrix is-detailed reference-task-table${canWrite ? " has-row-selection" : ""}`} style={{ "--schedule-min-width": canWrite ? "1336px" : "1252px" }}><colgroup>{canWrite && <col style={{ width: 28 }} />}{columnWidths.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}{canWrite && <col style={{ width: 56 }} />}</colgroup><thead><tr>{canWrite && <th className="reference-task-select"><input type="checkbox" checked={allSelected} onChange={(event) => onSelectAll?.(event.target.checked)} aria-label="표시된 업무 전체 선택" /></th>}<th>매체</th><th>업무분야</th><th>업무</th><th>세부내용</th><th>일정</th><th>기간</th><th>진행률</th><th>상태</th><th>담당</th><th>완료링크</th><th>비고</th>{canWrite && <th>관리</th>}</tr></thead><tbody>{bodyRows}</tbody></table></div>;
}

const scheduleStatusFilters = [["ALL", "전체"], ["TODO", "미착수"], ["ACTIVE", "진행"], ["DONE", "완료"], ["HOLD", "보류"]];
const scheduleCategoryFilters = [["ALL", "전체"], ["마케팅", "마케팅"], ["디자인", "디자인"], ["영상", "영상"]];
const scheduleWeekFilters = [["ALL", "전체"], ["TODAY", "오늘"], ["LAST_WEEK", "지난주"], ["THIS_WEEK", "이번주"], ["NEXT_WEEK", "다음주"], ["THIS_MONTH", "이번달"]];

function ScheduleFilterButtons({ label, value, options, onChange }) {
  return <div className="task-schedule-filter-group"><span>{label}</span><div role="group" aria-label={label}>{options.map(([id, text]) => <button type="button" key={id} className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div></div>;
}

function TaskScheduleFilters({ groups, count, total, onReset }) {
  const applied = groups.filter(group => group.value !== "ALL");
  return <section className="schedule-filter-panel" aria-label="일정표 업무 필터">
    <header className="schedule-filter-heading"><div><strong>업무 필터</strong><small>여러 조건을 함께 선택할 수 있습니다</small></div><span className="schedule-filter-count" aria-live="polite"><strong>{count}</strong> / {total}건</span></header>
    <div className="schedule-filter-rows">{groups.map(group => <div key={group.id} id={`schedule-filter-${group.id}`}><ScheduleFilterButtons label={group.label} value={group.value} options={group.options} onChange={group.onChange} /></div>)}</div>
    {applied.length > 0 && <div className="schedule-applied-filters"><span>적용 조건</span>{applied.map(group => <button type="button" key={group.id} aria-label={`${group.label} 필터 해제`} onClick={() => group.onChange("ALL")}>{group.options.find(([id]) => id === group.value)?.[1] || group.value}<X size={11} /></button>)}<button type="button" className="schedule-filter-reset" onClick={onReset}>전체 해제</button></div>}
  </section>;
}

function TaskWorkspaceTabs({ activeView, onChange, canViewActivity }) {
  return <div className="campaign-schedule-view-tabs seg task-workspace-tabs" role="tablist" aria-label="업무 화면 전환">
    <button type="button" role="tab" aria-selected={activeView === "table"} className={activeView === "table" ? "is-active" : ""} onClick={() => onChange("table")}><span>일정표</span>{activeView === "table" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>
    <button type="button" role="tab" aria-selected={activeView === "gantt"} className={activeView === "gantt" ? "is-active" : ""} onClick={() => onChange("gantt")}><span>간트</span>{activeView === "gantt" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>
    {canViewActivity && <button type="button" role="tab" aria-selected={activeView === "activity"} className={activeView === "activity" ? "is-active" : ""} onClick={() => onChange("activity")}><span>업무 로그</span>{activeView === "activity" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>}
  </div>;
}

const issueStatusOrder = ["NOT_STARTED", "IN_PROGRESS", "DONE", "ON_HOLD"];
const issueStatusLabels = { NOT_STARTED: "예정", IN_PROGRESS: "진행중", DONE: "완료", ON_HOLD: "보류" };

function ProjectIssueRow({ issue, index, canWrite, onUpdate, onArchive }) {
  const [draft, setDraft] = useState(() => ({
    issue_date: issue.date || localDateValue(),
    due_date: issue.dueDate || "",
    kind_text: issue.kind || "",
    related_task_text: issue.relatedTask || "",
    body_text: issue.body || "",
    owner_text: issue.owner || "",
    status_code: issue.statusCode || "IN_PROGRESS",
    completion_url: issue.completionUrl || "",
    remarks: issue.remarks || "",
  }));
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    setDraft({
      issue_date: issue.date || localDateValue(),
      due_date: issue.dueDate || "",
      kind_text: issue.kind || "",
      related_task_text: issue.relatedTask || "",
      body_text: issue.body || "",
      owner_text: issue.owner || "",
      status_code: issue.statusCode || "IN_PROGRESS",
      completion_url: issue.completionUrl || "",
      remarks: issue.remarks || "",
    });
  }, [issue.id, issue.rowVersion]);
  const setField = (field, value) => {
    setSaveError("");
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const persistedValue = (field) => ({
    issue_date: issue.date || "",
    due_date: issue.dueDate || "",
    kind_text: issue.kind || "",
    related_task_text: issue.relatedTask || "",
    body_text: issue.body || "",
    owner_text: issue.owner || "",
    status_code: issue.statusCode || "IN_PROGRESS",
    completion_url: issue.completionUrl || "",
    remarks: issue.remarks || "",
  }[field]);
  const commitField = async (field, rawValue) => {
    if (!canWrite || savingField) return;
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (field === "issue_date" && !value) {
      setField(field, persistedValue(field));
      setSaveError("등록일을 입력해 주세요.");
      return;
    }
    if (field === "completion_url" && value && !validInlineTaskUrl(value)) {
      setSaveError("완료링크는 http:// 또는 https:// 주소로 입력해 주세요.");
      return;
    }
    if (String(persistedValue(field)) === String(value)) return;
    setSavingField(field);
    setSaveError("");
    try {
      await onUpdate(issue, { [field]: value });
    } catch (error) {
      setField(field, persistedValue(field));
      setSaveError(error?.message || "변경사항을 저장하지 못했습니다.");
    } finally {
      setSavingField("");
    }
  };
  const commitOnEnter = (event, field) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.blur();
  };
  const cycleStatus = () => {
    if (!canWrite || savingField) return;
    const currentIndex = Math.max(0, issueStatusOrder.indexOf(draft.status_code));
    const next = issueStatusOrder[(currentIndex + 1) % issueStatusOrder.length];
    setField("status_code", next);
    void commitField("status_code", next);
  };
  const archive = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSavingField("archive");
    setSaveError("");
    try {
      await onArchive(issue);
    } catch (error) {
      setDeleteArmed(false);
      setSaveError(error?.message || "행을 삭제하지 못했습니다.");
      setSavingField("");
    }
  };
  const disabled = !canWrite || Boolean(savingField);
  return <tr className={savingField ? "is-saving" : ""}>
    <td className="project-issue-number">{index + 1}</td>
    <td><div className="project-issue-date-stack"><label className="project-issue-date-field"><span>등록일</span><input type="date" aria-label={`${index + 1}번 이슈 등록일`} disabled={disabled} value={draft.issue_date} onChange={(event) => setField("issue_date", event.target.value)} onBlur={(event) => void commitField("issue_date", event.currentTarget.value)} /></label><label className="project-issue-date-field is-deadline"><span>컨펌 마감일</span><input type="date" aria-label={`${index + 1}번 이슈 컨펌 마감일`} disabled={disabled} value={draft.due_date} onChange={(event) => setField("due_date", event.target.value)} onBlur={(event) => void commitField("due_date", event.currentTarget.value)} /></label></div></td>
    <td><input type="text" aria-label={`${index + 1}번 이슈 구분`} maxLength={100} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.kind_text} placeholder={canWrite ? "추가업무" : ""} onChange={(event) => setField("kind_text", event.target.value)} onBlur={(event) => void commitField("kind_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "kind_text")} /></td>
    <td><input type="text" aria-label={`${index + 1}번 관련 업무`} maxLength={500} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.related_task_text} placeholder={canWrite ? "관련 업무" : ""} onChange={(event) => setField("related_task_text", event.target.value)} onBlur={(event) => void commitField("related_task_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "related_task_text")} /></td>
    <td><textarea rows="1" aria-label={`${index + 1}번 이슈 내용`} maxLength={20000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.body_text} placeholder={canWrite ? "내용을 입력하세요" : ""} onChange={(event) => setField("body_text", event.target.value)} onBlur={(event) => void commitField("body_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "body_text")} /></td>
    <td><input type="text" aria-label={`${index + 1}번 이슈 담당자`} maxLength={100} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.owner_text} placeholder={canWrite ? "담당자" : ""} onChange={(event) => setField("owner_text", event.target.value)} onBlur={(event) => void commitField("owner_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "owner_text")} /></td>
    <td><button type="button" className={`project-issue-status is-${draft.status_code.toLowerCase()}`} disabled={disabled} title="눌러서 예정 → 진행중 → 완료 → 보류 순으로 변경" onClick={cycleStatus}>{savingField === "status_code" ? <LoaderCircle size={12} className="spin" /> : issueStatusLabels[draft.status_code] || draft.status_code}</button></td>
    <td><div className="project-issue-link">{validInlineTaskUrl(draft.completion_url) && <a href={draft.completion_url} target="_blank" rel="noreferrer" aria-label={`${index + 1}번 완료링크 열기`}>열기 ↗</a>}<input type="text" inputMode="url" aria-label={`${index + 1}번 완료링크`} maxLength={2048} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.completion_url} placeholder={canWrite ? "https://" : ""} onChange={(event) => setField("completion_url", event.target.value)} onBlur={(event) => void commitField("completion_url", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "completion_url")} /></div></td>
    <td><textarea rows="1" aria-label={`${index + 1}번 이슈 비고`} maxLength={10000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.remarks} placeholder={canWrite ? "비고" : ""} onChange={(event) => setField("remarks", event.target.value)} onBlur={(event) => void commitField("remarks", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "remarks")} />{saveError && <small role="alert">{saveError}</small>}</td>
    {canWrite && <td className="project-issue-action"><button type="button" className={deleteArmed ? "is-armed" : ""} disabled={Boolean(savingField)} onClick={archive} aria-label={`${index + 1}번 이슈 삭제`}>{savingField === "archive" ? <LoaderCircle size={13} className="spin" /> : deleteArmed ? "삭제?" : "×"}</button></td>}
  </tr>;
}

export function ProjectIssuePanel({ issues, project, canWrite, actorName, onCreate, onUpdate, onArchive }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const owners = [...new Set([project?.clientName || "고객사", "포켓컴퍼니", "NS"])];
  return <section className="panel project-issue-panel" aria-label="확인 요청">
    <header className="panel-head reference-panel-head"><div><h2>확인 요청</h2><span className="hint">요청을 열지 않고 답변·마감일·확인 상태를 바로 처리합니다</span></div>{canWrite && <button type="button" className="project-issue-ledger-toggle" aria-expanded={ledgerOpen} onClick={() => setLedgerOpen((value) => !value)}>{ledgerOpen ? "카드로 보기" : "원장 편집"}</button>}</header>
    {issues.length ? <div className="project-issue-card-list">{issues.map((issue) => <IssueRequestCard key={issue.id} issue={issue} canWrite={canWrite} actorName={actorName} onUpdate={onUpdate} onArchive={onArchive} />)}</div> : <div className="project-issue-card-empty">등록된 확인 요청이 없습니다.</div>}
    {ledgerOpen && <div className="project-issue-scroll"><table id="issueTable"><thead><tr><th>No</th><th>등록일</th><th>구분</th><th>관련 업무</th><th>내용</th><th>담당자</th><th>상태</th><th>완료링크</th><th>비고</th>{canWrite && <th aria-label="행 작업" />}</tr></thead><tbody>
      {issues.length ? issues.map((issue, index) => <ProjectIssueRow key={issue.id} issue={issue} index={index} canWrite={canWrite} onUpdate={onUpdate} onArchive={onArchive} />) : <tr><td colSpan={canWrite ? 10 : 9} className="project-issue-empty">기록된 이슈가 없습니다.</td></tr>}
    </tbody></table></div>}
    {canWrite && <footer className="project-issue-footer"><button type="button" className="project-issue-add" onClick={() => setComposeOpen(true)}><Plus size={14} />확인 요청 추가</button></footer>}
    {composeOpen && <Suspense fallback={<LoadingState label="확인요청 작성 화면을 여는 중입니다." />}><IssueRequestCreateModal projects={[project]} initialProjectId={project?.id} owners={owners} actorName={actorName} onCreate={onCreate} onClose={() => setComposeOpen(false)} /></Suspense>}
  </section>;
}

export function TaskScheduleTimeline({ tasks, issues, project, query, canWrite, canWriteIssues, actorName, canEditProject, canManageVisibility = false, onUpdate, onArchive, onBatchUpdate, onProjectUpdate, onCreate, onIssueCreate, onIssueUpdate, onIssueArchive, displayMode, onViewChange, canViewActivity, activityState, onLoadActivity, summaryOnly = false, showOwners = true }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [scheduleFilter, setScheduleFilter] = useState("ALL");
  const [mediaFilter, setMediaFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkVisibility, setBulkVisibility] = useState("");
  const [bulkSave, setBulkSave] = useState({ status: "idle", error: "" });
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [draggingTaskIds, setDraggingTaskIds] = useState([]);
  const [taskDropIndicator, setTaskDropIndicator] = useState(null);
  const [startDateDraft, setStartDateDraft] = useState(project.startDate || "");
  const [startDateSaving, setStartDateSaving] = useState(false);
  const [startDateError, setStartDateError] = useState("");
  const [ganttSave, setGanttSave] = useState({ status: "idle", saved: 0, total: 0, error: "" });
  const [ganttDrafts, setGanttDrafts] = useState(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const activityMode = displayMode === "activity";
  const matrixRef = useRef(null);
  const schedulePanelRef = useRef(null);
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  useEffect(() => {
    const panel = schedulePanelRef.current;
    if (!panel) return;
    const measure = () => setGanttViewportWidth(panel.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const paintRef = useRef(null);
  const ganttTasksRef = useRef([]);
  const daysRef = useRef([]);
  const selectionAnchorRef = useRef(null);
  const dragAutoScrollRef = useRef({ frame: null, container: null, speed: 0 });
  const draggingTaskIdsRef = useRef([]);
  const taskDropIndicatorRef = useRef(null);
  const ganttHoverRef = useRef({ rowIndex: null, dayIndex: null });
  useEffect(() => {
    setStatusFilter("ALL");
    setCategoryFilter("ALL");
    setScheduleFilter("ALL");
    setMediaFilter("ALL");
    setOwnerFilter("ALL");
    setEditingTaskId(null);
    setSelectedTaskIds(new Set());
    setBulkStatus("");
    setBulkOwner("");
    setBulkVisibility("");
    setBulkSave({ status: "idle", error: "" });
    setBulkDeleteArmed(false);
    setDraggingTaskId(null);
    setDraggingTaskIds([]);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = [];
    taskDropIndicatorRef.current = null;
    setGanttSave({ status: "idle", saved: 0, total: 0, error: "" });
    setGanttDrafts(null);
    paintRef.current = null;
    selectionAnchorRef.current = null;
  }, [project.id]);
  useEffect(() => {
    setFreshnessNow(Date.now());
    const timer = globalThis.setInterval?.(() => setFreshnessNow(Date.now()), 60 * 1000);
    return () => globalThis.clearInterval?.(timer);
  }, [project.id]);
  useEffect(() => {
    setStartDateDraft(project.startDate || "");
    setStartDateError("");
  }, [project.id, project.startDate]);
  const searchNeedle = String(query || "").trim().toLowerCase();
  const mediaOptions = useMemo(() => [["ALL", "전체"], ...[...new Set(tasks.map(taskScheduleMedia))].map(media => [media, media])], [tasks]);
  const ownerOptions = [["ALL", "전체"], ["POCKET", "포켓 업무"], ["NS", "NS 업무"]];
  const resetScheduleFilters = () => {
    setStatusFilter("ALL"); setCategoryFilter("ALL"); setScheduleFilter("ALL"); setMediaFilter("ALL"); setOwnerFilter("ALL");
  };
  const ganttVisibleTasks = useMemo(() => filterTaskSchedule(tasks, {
    status: statusFilter,
    category: categoryFilter,
    schedule: scheduleFilter,
    media: mediaFilter,
    owner: canWrite ? ownerFilter : "ALL",
  }).filter((task) => !searchNeedle || `${task.title} ${task.description || ""} ${task.parent || ""} ${taskScheduleCategory(task)}`.toLowerCase().includes(searchNeedle)), [tasks, statusFilter, categoryFilter, scheduleFilter, mediaFilter, ownerFilter, canWrite, searchNeedle]);
  const filteredTasks = useMemo(() => groupTaskScheduleByMedia(ganttVisibleTasks), [ganttVisibleTasks]);
  const ganttLabelWidth = useMemo(() => ganttTaskLabelWidth(filteredTasks, { canWrite, showOwners }), [filteredTasks, canWrite, showOwners]);
  const reorderEnabled = canWrite && statusFilter === "ALL" && categoryFilter === "ALL" && scheduleFilter === "ALL" && mediaFilter === "ALL" && ownerFilter === "ALL" && !searchNeedle;
  const statusSummaryTasks = useMemo(() => filterTaskSchedule(tasks, {
    status: "ALL",
    category: categoryFilter,
    schedule: scheduleFilter,
    media: mediaFilter,
    owner: canWrite ? ownerFilter : "ALL",
  }), [tasks, categoryFilter, scheduleFilter, mediaFilter, ownerFilter, canWrite]);
  const timeline = useMemo(
    () => buildTaskTimeline(filteredTasks, project),
    [filteredTasks, project.startDate, project.endDate],
  );
  const summary = useMemo(() => {
    const countable = statusSummaryTasks.filter((task) => task.statusCode !== "CANCELLED");
    const completed = countable.filter((task) => ["DONE", "COMPLETED"].includes(task.statusCode)).length;
    return {
      done: statusSummaryTasks.filter((task) => ["DONE", "COMPLETED"].includes(task.statusCode)).length,
      inProgress: statusSummaryTasks.filter((task) => ["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(task.statusCode)).length,
      onHold: statusSummaryTasks.filter((task) => ["ON_HOLD", "BLOCKED"].includes(task.statusCode)).length,
      countable,
      completed,
      completionRate: countable.length ? Math.round(completed / countable.length * 100) : 0,
    };
  }, [statusSummaryTasks]);
  const { done, inProgress, onHold, countable, completed, completionRate } = summary;
  const missingSchedule = useMemo(() => filteredTasks.filter((task) => !task.plannedStartDate || !task.dueDate).length, [filteredTasks]);
  const today = localDateValue();
  const overdueHoldRanges = useMemo(() => new Map(filteredTasks
    .map((task) => [task.id, overdueTaskHoldRange(task, today)])
    .filter(([, range]) => Boolean(range))), [filteredTasks, today]);
  const timelineEnd = useMemo(() => [...overdueHoldRanges.values()]
    .reduce((latest, range) => !latest || range.endDate > latest ? range.endDate : latest, timeline.end), [overdueHoldRanges, timeline.end]);
  const days = useMemo(() => buildGanttAxis(
    timeline.start,
    timelineEnd,
    Math.ceil(Math.max(0, ganttViewportWidth - ganttLabelWidth) / GANTT_DAY_WIDTH),
  ), [timeline.start, timelineEnd, ganttViewportWidth, ganttLabelWidth]);
  const months = useMemo(() => days.reduce((items, day) => {
    const last = items[items.length - 1];
    if (last?.key === day.monthKey) last.count += 1;
    else items.push({ key: day.monthKey, tone: day.monthTone, label: `${Number(day.monthKey.slice(0, 4))}년 ${Number(day.monthKey.slice(5, 7))}월`, count: 1 });
    return items;
  }, []), [days]);
  const ganttTrackWidth = days.length * GANTT_DAY_WIDTH;
  const todayIndex = days.findIndex((day) => day.iso === today);
  const ganttGroups = useMemo(() => groupGanttTasks(filteredTasks, taskScheduleMedia), [filteredTasks]);
  const ganttTasks = filteredTasks;
  const ganttRowIndexById = useMemo(() => new Map(ganttTasks.map((task, index) => [task.id, index])), [ganttTasks]);
  const ganttCategoryColor = (category) => ({
    "마케팅": "#0058ff",
    "디자인": "#c2318a",
    "영상": "#d42b20",
    "YouTube": "#d42b20",
    "유튜브": "#d42b20",
    "Instagram": "#c2318a",
    "인스타그램": "#c2318a",
    "네이버": "#0b9d4e",
    "네이버블로그": "#0b9d4e",
    "네이버 블로그": "#0b9d4e",
    "SEO": "#b06800",
    "TikTok": "#1b2430",
    "틱톡": "#1b2430",
    "Ads": "#b06800",
    "광고": "#b06800",
  }[category] || "#6e7177");
  const ganttFillColor = (task) => {
    const color = ganttCategoryColor(taskScheduleMedia(task));
    if (task.statusCode === "DONE") return color;
    if (["ON_HOLD", "BLOCKED"].includes(task.statusCode)) return `color-mix(in srgb, ${color} 16%, #fff)`;
    if (["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(task.statusCode)) return `color-mix(in srgb, ${color} 68%, #fff)`;
    return `color-mix(in srgb, ${color} 30%, #fff)`;
  };
  const scheduleClass = (task) => {
    if (task.statusCode === "DONE") return "is-done";
    if (["ON_HOLD", "BLOCKED"].includes(task.statusCode)) return "is-hold";
    if (task.streamCode === "YOUTUBE") return "is-youtube";
    if (task.streamCode === "INSTAGRAM") return "is-instagram";
    if (task.streamCode === "SEO") return "is-seo";
    return "is-active";
  };
  ganttTasksRef.current = ganttTasks;
  daysRef.current = days;

  useEffect(() => {
    const available = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  const selectTask = (taskId, checked, options = {}) => {
    setBulkDeleteArmed(false);
    setSelectedTaskIds((current) => {
      if (options.shiftKey && selectionAnchorRef.current) {
        return selectTaskRange(filteredTasks, current, selectionAnchorRef.current, taskId, checked);
      }
      const next = new Set(current);
      if (checked) next.add(taskId); else next.delete(taskId);
      return next;
    });
    selectionAnchorRef.current = taskId;
  };
  const selectAllVisible = (checked) => {
    setBulkDeleteArmed(false);
    selectionAnchorRef.current = null;
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      filteredTasks.forEach((task) => { if (checked) next.add(task.id); else next.delete(task.id); });
      return next;
    });
  };
  const saveUpdateChunks = async (updates) => {
    for (let offset = 0; offset < updates.length; offset += 40) {
      const batch = updates.slice(offset, offset + 40);
      if (onBatchUpdate) await onBatchUpdate(batch);
      else for (const update of batch) {
        if (update.operation === "ARCHIVE") await onArchive(update.task);
        else await onUpdate(update.task, update.fields);
      }
    }
  };
  const applyBulkUpdate = async () => {
    if (bulkSave.status === "saving") return;
    if (!bulkStatus && !bulkOwner && !bulkVisibility) {
      setBulkSave({ status: "error", error: "변경할 상태, 담당 또는 고객 공개 범위를 선택해 주세요." });
      return;
    }
    const selectedTasks = tasks.filter((task) => selectedTaskIds.has(task.id));
    if (!selectedTasks.length) return;
    const updates = selectedTasks.map((task) => ({
      task,
      fields: {
        ...(bulkStatus ? taskStatusMutationFields(bulkStatus, task) : {}),
        ...(bulkOwner ? { responsible_org_code: bulkOwner } : {}),
        ...(bulkVisibility ? { visibility_code: bulkVisibility } : {}),
      },
    }));
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(updates);
      setSelectedTaskIds(new Set());
      setBulkStatus("");
      setBulkOwner("");
      setBulkVisibility("");
      setBulkDeleteArmed(false);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkSave({ status: "error", error: error?.message || "일괄 변경을 저장하지 못했습니다." });
    }
  };
  const applyBulkArchive = async () => {
    if (bulkSave.status === "saving") return;
    const selectedTasks = tasks.filter((task) => selectedTaskIds.has(task.id));
    if (!selectedTasks.length) return;
    if (!bulkDeleteArmed) {
      setBulkDeleteArmed(true);
      setBulkSave({ status: "idle", error: "삭제할 업무가 맞으면 삭제 확정을 한 번 더 눌러 주세요." });
      return;
    }
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(selectedTasks.map((task) => ({ task, operation: "ARCHIVE", fields: {} })));
      setSelectedTaskIds(new Set());
      selectionAnchorRef.current = null;
      setBulkDeleteArmed(false);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkDeleteArmed(false);
      setBulkSave({ status: "error", error: error?.message || "선택 업무를 삭제하지 못했습니다." });
    }
  };
  const stopTaskAutoScroll = useCallback(() => {
    const scroll = dragAutoScrollRef.current;
    if (scroll.frame) globalThis.cancelAnimationFrame?.(scroll.frame);
    dragAutoScrollRef.current = { frame: null, container: null, speed: 0 };
  }, []);
  const runTaskAutoScroll = useCallback(() => {
    const tick = () => {
      const scroll = dragAutoScrollRef.current;
      if (!scroll.container || !scroll.speed) {
        scroll.frame = null;
        return;
      }
      scroll.container.scrollTop += scroll.speed;
      scroll.frame = globalThis.requestAnimationFrame?.(tick) || null;
    };
    if (!dragAutoScrollRef.current.frame) dragAutoScrollRef.current.frame = globalThis.requestAnimationFrame?.(tick) || null;
  }, []);
  const updateTaskAutoScroll = useCallback((event) => {
    const container = event.currentTarget?.closest?.(".reference-task-scroll, .reference-gantt-scroll");
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const edge = Math.min(72, Math.max(44, bounds.height * 0.12));
    const topDistance = event.clientY - bounds.top;
    const bottomDistance = bounds.bottom - event.clientY;
    let speed = 0;
    if (topDistance < edge) speed = -Math.ceil((edge - Math.max(0, topDistance)) / edge * 18);
    else if (bottomDistance < edge) speed = Math.ceil((edge - Math.max(0, bottomDistance)) / edge * 18);
    dragAutoScrollRef.current.container = container;
    dragAutoScrollRef.current.speed = speed;
    if (speed) runTaskAutoScroll();
  }, [runTaskAutoScroll]);
  const startTaskDrag = (taskId) => {
    const ids = selectedTaskIds.has(taskId)
      ? filteredTasks.filter((task) => selectedTaskIds.has(task.id)).map((task) => task.id)
      : [taskId];
    setDraggingTaskId(taskId);
    setDraggingTaskIds(ids);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = ids;
    taskDropIndicatorRef.current = null;
  };
  const finishTaskDrag = useCallback(() => {
    stopTaskAutoScroll();
    setDraggingTaskId(null);
    setDraggingTaskIds([]);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = [];
    taskDropIndicatorRef.current = null;
  }, [stopTaskAutoScroll]);
  useEffect(() => () => stopTaskAutoScroll(), [stopTaskAutoScroll]);
  const handleTaskDragOver = (event, targetTaskId) => {
    const draggedIds = draggingTaskIdsRef.current;
    if (!reorderEnabled || !draggedIds.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateTaskAutoScroll(event);
    if (draggedIds.includes(targetTaskId)) {
      setTaskDropIndicator(null);
      taskDropIndicatorRef.current = null;
      return;
    }
    const row = event.currentTarget?.closest?.(".task-schedule-row, .g-row") || event.currentTarget;
    const bounds = row?.getBoundingClientRect?.();
    const position = bounds && event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    taskDropIndicatorRef.current = { taskId: targetTaskId, position };
    setTaskDropIndicator((current) => current?.taskId === targetTaskId && current.position === position ? current : { taskId: targetTaskId, position });
  };
  const dropTasksAt = async (targetTaskId) => {
    const sourceIds = draggingTaskIdsRef.current.length ? draggingTaskIdsRef.current.slice() : (draggingTaskId ? [draggingTaskId] : []);
    const indicator = taskDropIndicatorRef.current;
    const position = indicator?.taskId === targetTaskId ? indicator.position : "before";
    const targetTask = filteredTasks.find((task) => task.id === targetTaskId);
    const targetMediaCode = taskScheduleMediaCode(targetTask);
    finishTaskDrag();
    if (!reorderEnabled || !sourceIds.length || !targetTask) return;
    const ordered = reorderTaskSchedule(filteredTasks, sourceIds, targetTaskId, position);
    if (ordered.every((task, index) => task.id === filteredTasks[index]?.id)) return;
    const sourceSet = new Set(sourceIds);
    const updates = ordered.map((task, index) => {
      const fields = { sort_order: (index + 1) * 10 };
      if (sourceSet.has(task.id) && targetMediaCode && taskScheduleMediaCode(task) !== targetMediaCode) fields.category_code = targetMediaCode;
      return { task, fields };
    }).filter(({ task, fields }) => Number(task.sortOrder) !== fields.sort_order || fields.category_code);
    if (!updates.length) return;
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(updates);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkSave({ status: "error", error: error?.message || "업무 순서를 저장하지 못했습니다." });
    }
  };
  const updateGanttQuickField = async (task, field, value) => {
    const fields = field === "status_code" ? taskStatusMutationFields(value, task) : { [field]: value };
    setGanttSave({ status: "saving", saved: 0, total: 1, error: "" });
    try {
      await onUpdate(task, fields);
      setGanttSave({ status: "saved", saved: 1, total: 1, error: "" });
    } catch (error) {
      setGanttSave({ status: "error", saved: 0, total: 1, error: error?.message || "업무를 저장하지 못했습니다." });
    }
  };
  const clearGanttAxisHighlight = useCallback(() => {
    const root = matrixRef.current;
    if (root) {
      root.querySelectorAll(".is-axis-hover-row, .is-axis-hover-column, .is-axis-hover-intersection").forEach((element) => {
        element.classList.remove("is-axis-hover-row", "is-axis-hover-column", "is-axis-hover-intersection");
      });
    }
    ganttHoverRef.current = { rowIndex: null, dayIndex: null };
  }, []);
  const highlightGanttAxes = useCallback((event) => {
    if (paintRef.current) return;
    const root = matrixRef.current;
    const cell = event.target.closest?.(".g-c[data-gantt-row-index][data-gantt-day-index]");
    if (!root || !cell || !root.contains(cell)) {
      clearGanttAxisHighlight();
      return;
    }
    const rowIndex = Number(cell.dataset.ganttRowIndex);
    const dayIndex = Number(cell.dataset.ganttDayIndex);
    const previous = ganttHoverRef.current;
    if (previous.rowIndex === rowIndex && previous.dayIndex === dayIndex) return;
    clearGanttAxisHighlight();
    root.querySelector(`.g-row[data-gantt-row-index="${rowIndex}"]`)?.classList.add("is-axis-hover-row");
    root.querySelectorAll(`[data-gantt-day-index="${dayIndex}"]`).forEach((element) => element.classList.add("is-axis-hover-column"));
    cell.classList.add("is-axis-hover-intersection");
    ganttHoverRef.current = { rowIndex, dayIndex };
  }, [clearGanttAxisHighlight]);

  const repaintGantt = useCallback((paint) => {
    const root = matrixRef.current;
    if (!root || !paint?.drafts) return;
    const rowStart = Math.min(paint.anchor.rowIndex, paint.target.rowIndex);
    const rowEnd = Math.max(paint.anchor.rowIndex, paint.target.rowIndex);
    const dayStart = Math.min(paint.anchor.dayIndex, paint.target.dayIndex);
    const dayEnd = Math.max(paint.anchor.dayIndex, paint.target.dayIndex);
    const axisDays = paint.anchor.axisDays;
    const previous = paint.previewRange || { rowStart, rowEnd };
    const dirtyRowStart = Math.min(previous.rowStart, rowStart);
    const dirtyRowEnd = Math.max(previous.rowEnd, rowEnd);
    for (let dirtyRow = dirtyRowStart; dirtyRow <= dirtyRowEnd; dirtyRow += 1) {
      const taskId = paint.rows[dirtyRow]?.id;
      const dates = new Set(paint.drafts.get(taskId) || []);
      root.querySelectorAll(`.g-c[data-gantt-row-index="${dirtyRow}"]`).forEach((cell) => {
        const rowIndex = Number(cell.dataset.ganttRowIndex);
        const dayIndex = Number(cell.dataset.ganttDayIndex);
        const date = axisDays[dayIndex];
        const active = dates.has(date);
        const runStart = active && !dates.has(axisDays[dayIndex - 1]);
        const runEnd = active && !dates.has(axisDays[dayIndex + 1]);
        const preview = rowIndex >= rowStart && rowIndex <= rowEnd && dayIndex >= dayStart && dayIndex <= dayEnd;
        cell.classList.toggle("on", active);
        cell.classList.toggle("rs", runStart);
        cell.classList.toggle("re", runEnd);
        cell.classList.toggle("is-paint-preview", preview);
        cell.classList.toggle("is-paint-add", preview && paint.mode === "paint");
        cell.classList.toggle("is-paint-erase", preview && paint.mode === "erase");
      });
    }
    paint.previewRange = { rowStart, rowEnd, dayStart, dayEnd };
  }, []);

  const paintTo = useCallback((rowIndex, dayIndex) => {
    const paint = paintRef.current;
    if (!paint || (paint.target.rowIndex === rowIndex && paint.target.dayIndex === dayIndex)) return;
    paint.target = { rowIndex, dayIndex };
    paint.drafts = paintGanttRectangle(paint.rows, paint.anchor, paint.target, paint.mode);
    repaintGantt(paint);
  }, [repaintGantt]);

  const finishGanttPaint = useCallback(async () => {
    const paint = paintRef.current;
    if (!paint) return;
    paintRef.current = null;
    matrixRef.current?.classList.remove("is-painting");
    const changes = paint.rows.filter((row) => !scheduleDatesEqual(row.scheduleDates, paint.drafts.get(row.id)));
    if (!changes.length) {
      matrixRef.current?.querySelectorAll(".is-paint-preview, .is-paint-add, .is-paint-erase").forEach((cell) => cell.classList.remove("is-paint-preview", "is-paint-add", "is-paint-erase"));
      return;
    }

    setGanttDrafts(paint.drafts);
    setGanttSave({ status: "saving", saved: 0, total: changes.length, error: "" });
    let saved = 0;
    try {
      const updates = changes.map((row) => {
        const dates = paint.drafts.get(row.id) || [];
        const bounds = scheduleDateBounds(dates);
        return {
          task: row.task,
          fields: {
            planned_start_date: bounds.start,
            due_date: bounds.end,
            schedule_dates_json: serializeScheduleDates(dates),
          },
        };
      });
      if (onBatchUpdate) {
        for (let offset = 0; offset < updates.length; offset += 40) {
          const batch = updates.slice(offset, offset + 40);
          await onBatchUpdate(batch);
          saved += batch.length;
          setGanttSave({ status: "saving", saved, total: changes.length, error: "" });
        }
      } else {
        for (const update of updates) {
          await onUpdate(update.task, update.fields);
          saved += 1;
          setGanttSave({ status: "saving", saved, total: changes.length, error: "" });
        }
      }
      setGanttSave({ status: "saved", saved, total: changes.length, error: "" });
    } catch (error) {
      setGanttSave({
        status: "error",
        saved,
        total: changes.length,
        error: error?.code === "field_not_allowed" || /field_not_allowed/i.test(error?.message || "")
          ? "Apps Script의 간트 일정 필드를 먼저 반영해야 합니다."
          : error?.message || "간트 일정을 저장하지 못했습니다.",
      });
    } finally {
      setGanttDrafts(null);
    }
  }, [onBatchUpdate, onUpdate]);

  useEffect(() => {
    const move = (event) => {
      if (!paintRef.current) return;
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".g-c[data-gantt-task-id]");
      if (!target || !matrixRef.current?.contains(target)) return;
      paintTo(Number(target.dataset.ganttRowIndex), Number(target.dataset.ganttDayIndex));
    };
    const end = () => { void finishGanttPaint(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [finishGanttPaint, paintTo]);

  const beginGanttPaint = (event) => {
    if (displayMode !== "gantt" || !canWrite || ganttSave.status === "saving" || event.button !== 0) return;
    const cell = event.target.closest?.(".g-c[data-gantt-task-id]");
    if (!cell || !matrixRef.current?.contains(cell)) return;
    clearGanttAxisHighlight();
    event.preventDefault();
    const rowIndex = Number(cell.dataset.ganttRowIndex);
    const dayIndex = Number(cell.dataset.ganttDayIndex);
    const axisDays = daysRef.current.map((day) => day.iso);
    const rows = ganttTasksRef.current.map((task) => ({ id: task.id, task, scheduleDates: taskScheduleDates(task) }));
    const active = new Set(rows[rowIndex]?.scheduleDates || []).has(axisDays[dayIndex]);
    const paint = {
      mode: active ? "erase" : "paint",
      anchor: { rowIndex, dayIndex, axisDays },
      target: { rowIndex: -1, dayIndex: -1 },
      rows,
      drafts: new Map(),
      previewRange: null,
    };
    paintRef.current = paint;
    matrixRef.current.classList.add("is-painting");
    paintTo(rowIndex, dayIndex);
  };
  const saveProjectStartDate = async () => {
    if (!canEditProject || !onProjectUpdate || !startDateDraft || startDateSaving) return;
    setStartDateSaving(true);
    setStartDateError("");
    try {
      await onProjectUpdate(project, startDateDraft);
    } catch (error) {
      setStartDateError(error?.code === "conflict" ? "다른 사용자가 먼저 변경했습니다." : error?.message || "착수일을 저장하지 못했습니다.");
    } finally {
      setStartDateSaving(false);
    }
  };

  const renderGanttTaskRow = (task, groupLabel, color, seriesChild = false) => {
    const rowIndex = ganttRowIndexById.get(task.id);
    const scheduleDates = ganttDrafts?.get(task.id) || taskScheduleDates(task);
    const scheduleSet = new Set(scheduleDates);
    const owner = taskResponsibleOrgLabel(task.responsibleOrgCode, project.clientName);
    const newTask = isNewTask(task, freshnessNow);
    const overdueHold = overdueHoldRanges.get(task.id);
    return <div data-gantt-row-index={rowIndex} className={`g-row${seriesChild ? " is-series-child" : ""}${newTask ? " is-new-task" : ""}${selectedTaskIds.has(task.id) ? " is-selected" : ""}${draggingTaskIds.includes(task.id) ? " is-dragging" : ""}${taskDropIndicator?.taskId === task.id ? ` is-drop-${taskDropIndicator.position}` : ""}`} key={task.id} style={{ "--fill": ganttFillColor(task), "--rail": color }}>
      <div className="g-lbl" title={`${groupLabel} · ${task.title}`} onDragOver={(event) => handleTaskDragOver(event, task.id)} onDrop={(event) => { if (!reorderEnabled) return; event.preventDefault(); void dropTasksAt(task.id); }}>
        {canWrite && <input type="checkbox" checked={selectedTaskIds.has(task.id)} onChange={(event) => selectTask(task.id, event.target.checked, { shiftKey: event.nativeEvent?.shiftKey || event.shiftKey })} aria-label={`${task.title} 선택`} />}
        {canWrite && <span className="g-reorder-handle" draggable={reorderEnabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); startTaskDrag(task.id); }} onDragEnd={finishTaskDrag} title={reorderEnabled ? "끌어서 선택 업무 순서 이동" : "필터를 해제하면 순서를 이동할 수 있습니다"}><GripVertical size={13} /></span>}
        <i className="g-rail-dot" />
        <button type="button" className="g-task-open nm" disabled={!canWrite} onClick={() => canWrite && setEditingTaskId(task.id)}>{task.title}</button>
        {newTask && <span className="g-new-badge">신규</span>}
        {taskHiddenFromClient(task) && <span className="g-client-hidden-badge" title="고객사 계정에는 표시되지 않습니다"><LockKeyhole size={9} />고객 숨김</span>}
        {canWrite ? <select className={`g-task-status is-${taskScheduleStatusGroup(task).toLowerCase()}`} aria-label={`${task.title} 상태`} value={editableTaskStatusCode(task.statusCode)} disabled={ganttSave.status === "saving"} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => void updateGanttQuickField(task, "status_code", event.target.value)}>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select> : <span className={`g-task-status is-${taskScheduleStatusGroup(task).toLowerCase()}`}>{({ ACTIVE: "진행중", HOLD: "보류", DONE: "완료", TODO: "미착수" })[taskScheduleStatusGroup(task)] || trackerStatusLabels[task.statusCode] || "미지정"}</span>}
        {showOwners && (canWrite ? <select className={`g-owner-select ${task.responsibleOrgCode === "POCKET" ? "op" : task.responsibleOrgCode === "NS" ? "on" : "oc"}`} aria-label={`${task.title} 담당`} value={task.responsibleOrgCode || "POCKET"} disabled={ganttSave.status === "saving"} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => void updateGanttQuickField(task, "responsible_org_code", event.target.value)}>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select> : <span className={`otag ${task.responsibleOrgCode === "POCKET" ? "op" : task.responsibleOrgCode === "NS" ? "on" : "oc"}`}>{owner}</span>)}
        {canWrite && <TaskRowActions compact task={task} onEdit={setEditingTaskId} onArchive={onArchive} disabled={ganttSave.status === "saving"} />}
      </div>
      <div className={`g-track ${canWrite ? "paint" : ""}`} style={{ width: `${ganttTrackWidth}px` }}>
        {days.map((day, dayIndex) => {
          const active = scheduleSet.has(day.iso);
          const starts = active && !scheduleSet.has(days[dayIndex - 1]?.iso);
          const ends = active && !scheduleSet.has(days[dayIndex + 1]?.iso);
          const overdueHeld = Boolean(overdueHold && day.iso >= overdueHold.startDate && day.iso <= overdueHold.endDate);
          const overdueStarts = overdueHeld && day.iso === overdueHold.startDate;
          const overdueEnds = overdueHeld && day.iso === overdueHold.endDate;
          return <div key={`${task.id}-${day.iso}`} data-r={task.id} data-ri={rowIndex} data-o={dayIndex} data-gantt-task-id={task.id} data-gantt-task-title={task.title} data-gantt-row-index={rowIndex} data-gantt-day-index={dayIndex} className={`g-c${ganttMonthClass(day)}${day.weekend ? " we" : ""}${day.iso === today ? " ref" : ""}${active ? " on" : ""}${starts ? " rs" : ""}${ends ? " re" : ""}${overdueHeld ? ` overdue-hold ${overdueHold.live ? "is-live" : "is-frozen"}` : ""}${overdueStarts ? " hold-start" : ""}${overdueEnds ? " hold-end" : ""}`} title={overdueHeld ? `${task.title} · 기한 초과 보류 ${day.iso}${overdueHold.live ? " (진행 중)" : " (종료)"}` : active ? `${task.title} · ${day.iso}` : day.iso} />;
        })}
        {todayIndex >= 0 && <div className="g-refline" style={{ left: `${todayIndex * GANTT_DAY_WIDTH}px` }} />}
      </div>
    </div>;
  };

  return <div className="campaign-schedule-board" aria-label="캠페인 운영 일정">
    {!summaryOnly && <>
    <QuoteSummary quote={project.quoteData} />
    <section className="campaign-board-progress" aria-label="전체 진행률"><div><span>전체 진행률</span><strong>{completionRate}<em>%</em></strong><small>완료 {completed}건 · 전체 {countable.length}건</small><div><i style={{ width: `${completionRate}%` }} /></div></div><div className="campaign-board-statuses"><button type="button" className={statusFilter === "ALL" ? "is-active" : ""} onClick={() => setStatusFilter("ALL")}><span>전체</span><strong>{countable.length}</strong></button><button type="button" className={statusFilter === "ACTIVE" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "ACTIVE"))}><span>진행중</span><strong>{inProgress}</strong></button><button type="button" className={statusFilter === "DONE" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "DONE"))}><span>완료</span><strong>{done}</strong></button><button type="button" className={statusFilter === "HOLD" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "HOLD"))}><span>보류</span><strong>{onHold}</strong></button></div></section>
    <div className="campaign-schedule-toolbar reference-toolbar toolbar">
      <TaskWorkspaceTabs activeView={displayMode} onChange={onViewChange} canViewActivity={canViewActivity} />
      {activityMode ? <div className="task-activity-toolbar-copy">사용자가 생성·완료·변경한 업무만 표시합니다.</div> : canEditProject && <div className="schedule-start-date refbox"><label><span>착수일</span><input type="date" value={startDateDraft} disabled={startDateSaving} onChange={(event) => { setStartDateDraft(event.target.value); setStartDateError(""); }} /></label><button type="button" className="btn" disabled={startDateSaving || !startDateDraft || startDateDraft === (project.startDate || "")} onClick={saveProjectStartDate}>{startDateSaving ? "저장 중" : "저장"}</button>{startDateError && <small role="alert">{startDateError}</small>}</div>}
    </div>
    {!activityMode && <TaskScheduleFilters key={project.id} count={filteredTasks.length} total={tasks.length} onReset={resetScheduleFilters} groups={[
      { id: "media", label: "매체별", value: mediaFilter, options: mediaOptions, onChange: setMediaFilter },
      { id: "category", label: "업무 분야별", value: categoryFilter, options: scheduleCategoryFilters, onChange: setCategoryFilter },
      { id: "period", label: "기간별", value: scheduleFilter, options: scheduleWeekFilters, onChange: setScheduleFilter },
      { id: "status", label: "업무 상태별", value: statusFilter, options: scheduleStatusFilters, onChange: setStatusFilter },
      ...(canWrite ? [{ id: "owner", label: "담당 업무별", value: ownerFilter, options: ownerOptions, onChange: setOwnerFilter }] : []),
    ]} />}
    </>}
    {!activityMode && canWrite && selectedTaskIds.size > 0 && <section className="task-bulk-toolbar" aria-label="선택 업무 일괄 변경"><strong>{selectedTaskIds.size}개 선택</strong><label><span>상태</span><select value={bulkStatus} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkStatus(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label><label><span>담당</span><select value={bulkOwner} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkOwner(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>{canManageVisibility && <label className="task-bulk-visibility"><span>고객사</span><select value={bulkVisibility} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkVisibility(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option><option value="PROJECT_TEAM">숨김 · 내부만</option><option value="CLIENT">공개</option></select></label>}<button type="button" className="btn primary" disabled={bulkSave.status === "saving"} onClick={() => void applyBulkUpdate()}>{bulkSave.status === "saving" ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}일괄 적용</button><button type="button" className={`btn task-bulk-delete${bulkDeleteArmed ? " is-armed" : ""}`} disabled={bulkSave.status === "saving"} onClick={() => void applyBulkArchive()}>{bulkSave.status === "saving" && bulkDeleteArmed ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}{bulkDeleteArmed ? `${selectedTaskIds.size}개 삭제 확정` : "선택 삭제"}</button><button type="button" className="btn" disabled={bulkSave.status === "saving"} onClick={() => { setSelectedTaskIds(new Set()); selectionAnchorRef.current = null; setBulkStatus(""); setBulkOwner(""); setBulkVisibility(""); setBulkDeleteArmed(false); setBulkSave({ status: "idle", error: "" }); }}>선택 해제</button>{bulkSave.error && <small role="alert">{bulkSave.error}</small>}</section>}
    <section ref={schedulePanelRef} className="task-timeline panel campaign-schedule-surface reference-schedule-panel" aria-label="업무 일정">
      <header className="campaign-schedule-table-heading panel-head reference-panel-head"><div><h2>{summaryOnly ? "프로젝트 간트" : activityMode ? "업무 로그" : displayMode === "gantt" ? "타임라인" : "업무 일정"}</h2><span className="hint">{activityMode ? "업무명과 변경 내용을 확인할 수 있는 누적 사용자 작업 이력" : <>{filteredTasks.length}건 표시{displayMode === "gantt" ? " · 머리글과 왼쪽 업무명 고정" : canWrite ? " · 업무명 수정 · 이동 손잡이로 순서 변경" : " · 업무명과 일정을 확인"}</>}</span>{!activityMode && ganttSave.status !== "idle" && <small className={`gantt-save-state is-${ganttSave.status}`}>{ganttSave.status === "saving" ? `업무 저장 중 ${ganttSave.saved}/${ganttSave.total}` : ganttSave.status === "saved" ? `${ganttSave.saved}개 업무 일정 저장 완료` : ganttSave.error}</small>}</div><div>{activityMode ? <button className="btn" type="button" onClick={() => onLoadActivity?.()} disabled={activityState?.status === "loading" || activityState?.loadingMore}>{activityState?.status === "loading" ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}새로고침</button> : <>{canWrite && onCreate && <button type="button" className="btn task-schedule-create" onClick={() => onCreate("task-completed")}><Check size={13} />완료 업무 추가</button>}{canWrite && onCreate && <button type="button" className="btn primary task-schedule-create" onClick={() => onCreate("task")}><Plus size={13} />업무 추가</button>}</>}</div></header>
      {displayMode === "gantt" && canWrite && <div className="g-hint"><span>✎</span><span>칸을 클릭하면 칠해지고, 다시 누르면 지워집니다. 옆으로 끌면 여러 칸을 한 번에 — 시작일·종료일·기간은 칠한 범위에 맞춰 자동으로 바뀝니다.</span></div>}
      {activityMode ? <TaskActivityLog state={activityState} tasks={tasks} clientName={project.clientName} onRefresh={() => onLoadActivity?.()} onLoadMore={(cursor) => onLoadActivity?.({ append: true, cursor })} /> : filteredTasks.length === 0 ? <EmptyState title={summaryOnly ? "등록된 업무가 없습니다" : "조건에 맞는 업무가 없습니다"} description={summaryOnly ? "업무를 등록하면 같은 일정이 여기에 표시됩니다." : "상태·카테고리·일정 필터를 변경해 주세요."} /> : displayMode === "gantt" && !days.length ? <EmptyState title={`일정 미등록 ${missingSchedule}건`} description="프로젝트 기간 또는 업무 날짜를 먼저 입력해 주세요." /> : displayMode === "table" ? <TaskScheduleInlineTable tasks={filteredTasks} project={project} canWrite={canWrite} onUpdate={onUpdate} onEdit={setEditingTaskId} onArchive={onArchive} ganttDrafts={ganttDrafts} freshnessNow={freshnessNow} scheduleClass={scheduleClass} mediaColor={ganttCategoryColor} selectedTaskIds={selectedTaskIds} onSelectTask={selectTask} onSelectAll={selectAllVisible} reorderEnabled={reorderEnabled} draggingTaskIds={draggingTaskIds} dropIndicator={taskDropIndicator} onDragStart={startTaskDrag} onDragEnd={finishTaskDrag} onDragOverTask={handleTaskDragOver} onDropTask={(taskId) => void dropTasksAt(taskId)} /> : <div className="reference-gantt-scroll scroll"><div id="gantt" ref={matrixRef} onPointerDown={beginGanttPaint} onPointerMove={highlightGanttAxes} onPointerLeave={clearGanttAxisHighlight} className="gantt reference-gantt" style={{ width: `${ganttLabelWidth + ganttTrackWidth}px`, minWidth: `${ganttLabelWidth + ganttTrackWidth}px`, "--gantt-label-width": `${ganttLabelWidth}px`, "--gantt-day-width": `${GANTT_DAY_WIDTH}px` }}>
        <div className="g-hrow"><div className="g-lbl g-corner">{canWrite && <input type="checkbox" checked={Boolean(filteredTasks.length && filteredTasks.every((task) => selectedTaskIds.has(task.id)))} onChange={(event) => selectAllVisible(event.target.checked)} aria-label="표시된 업무 전체 선택" />}<span className="nm">매체 · 업무</span></div><div className="g-hstack" style={{ width: `${ganttTrackWidth}px` }}><div className="g-months">{months.map((month) => <div className={`g-m month-tone-${month.tone}`} key={month.key} style={{ width: `${month.count * GANTT_DAY_WIDTH}px` }}>{month.label}</div>)}</div><div className="g-days">{days.map((day, dayIndex) => <div key={day.iso} data-gantt-day-index={dayIndex} className={`g-d${ganttMonthClass(day)}${day.weekend ? " we" : ""}${day.weekday === "일" ? " sun" : ""}${day.iso === today ? " ref" : ""}`}><span>{day.day}</span><span className="dw">{day.weekday}</span></div>)}</div></div></div>
        {ganttGroups.map((group) => {
          const color = ganttCategoryColor(group.label);
          const groupDone = group.tasks.filter((task) => task.statusCode === "DONE").length;
          return <section className="g-section" key={group.label}>
            <div className="g-grow"><div className="g-lbl" style={{ "--rail": color }}><span className="nm">{group.label}</span><span className="g-gcount">{groupDone}/{group.tasks.length}</span></div><div className="g-track g-gtrack" style={{ width: `${ganttTrackWidth}px` }}>{days.map((day, dayIndex) => <div key={`${group.label}-${day.iso}`} data-gantt-day-index={dayIndex} className={`g-c${ganttMonthClass(day)} ${day.weekend ? "we" : ""} ${day.iso === today ? "ref" : ""}`} />)}{todayIndex >= 0 && <div className="g-refline" style={{ left: `${todayIndex * GANTT_DAY_WIDTH}px` }} />}</div></div>
            {group.tasks.map((task) => renderGanttTaskRow(task, group.label, color))}
          </section>;
        })}
      </div></div>}
      {displayMode === "gantt" && <div className="g-legend">{ganttGroups.map((group) => <span key={group.label}><i style={{ background: ganttCategoryColor(group.label) }} />{group.label}</span>)}<span><i style={{ background: "#8a93a3", opacity: .3 }} />예정 = 옅게</span><span><i className="g-overdue-hold-legend" />기한 초과 보류</span><span><i className="g-weekend-legend" />주말</span><span><i className="g-today-legend" />기준일 {today}</span></div>}
      {editingTaskId && canWrite && <TaskEditModal key={editingTaskId} task={tasks.find((task) => task.id === editingTaskId)} clientName={project.clientName} onUpdate={onUpdate} onClose={() => setEditingTaskId(null)} />}
    </section>
    {!summaryOnly && !activityMode && <ProjectIssuePanel issues={issues} project={project} canWrite={canWriteIssues} actorName={actorName} onCreate={onIssueCreate} onUpdate={onIssueUpdate} onArchive={onIssueArchive} />}
  </div>;
}

function TasksView({ role, query, taskPage, activityState, onLoadActivity, onCreate, canWrite, actorName, onUpdate, onArchive, onBatchUpdate, onProjectUpdate, onIssueCreate, onIssueUpdate, onIssueArchive, initialSection = "schedule" }) {
  const editable = Boolean(canWrite);
  const schedule = useMemo(() => trackerSchedule(taskPage.project?.startDate), [taskPage.project?.startDate]);
  const tasks = useMemo(() => (taskPage.items || []).map((task) => {
    const calculatedDue = trackerTaskDue(task, schedule);
    const normalizedTask = { ...task, status: task.statusCode === "CANCELLED" ? "취소" : task.status };
    return withDisplayDeadline(normalizedTask, calculatedDue ? `${trackerTaskDueLabel(calculatedDue)} · ${trackerDdayLabel(calculatedDue)}` : "");
  }), [taskPage.items, schedule]);
  const [displayMode, setDisplayMode] = useState(initialSection === "activity" ? "activity" : "table");
  useEffect(() => {
    setDisplayMode(initialSection === "activity" ? "activity" : "table");
  }, [taskPage.project?.id, initialSection]);
  useEffect(() => {
    if (displayMode === "activity" && activityState?.status === "idle") onLoadActivity?.();
  }, [displayMode, activityState?.status, onLoadActivity]);
  const selectTaskView = (nextView) => setDisplayMode(nextView === "gantt" || nextView === "activity" ? nextView : "table");

  return <div className="view-stack campaign-schedule-root"><TaskScheduleTimeline tasks={tasks} issues={taskPage.issues || []} project={taskPage.project || {}} query={query} canWrite={editable} canWriteIssues={Boolean(editable && taskPage.issueCanWrite)} actorName={actorName} canEditProject={Boolean(editable && role === "pocket")} canManageVisibility={Boolean(editable && role === "pocket")} onUpdate={onUpdate} onArchive={onArchive} onBatchUpdate={onBatchUpdate} onProjectUpdate={onProjectUpdate} onCreate={onCreate} onIssueCreate={onIssueCreate} onIssueUpdate={onIssueUpdate} onIssueArchive={onIssueArchive} displayMode={displayMode} onViewChange={selectTaskView} canViewActivity={role !== "client"} activityState={activityState} onLoadActivity={onLoadActivity} /></div>;
}

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function operationsDashboardRange() {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const previousMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - 7);
  const currentSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + 6);
  const value = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { startDate: value(previousMonday), endDate: value(currentSunday) };
}

function DailyMeetingModal({ meeting, role, onClose, onSave }) {
  const [fields, setFields] = useState(() => ({
    meeting_date: meeting?.date || localDateValue(),
    title: meeting?.title || "데일리 미팅",
    attendees_text: meeting?.attendees || "",
    discussion_text: meeting?.discussion || "",
    decisions_text: meeting?.decisions || "",
    action_items_text: meeting?.actionItems || "",
    visibility_code: meeting?.visibilityCode || "PROJECT_TEAM",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(meeting || null, fields);
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="create-modal daily-meeting-modal" role="dialog" aria-modal="true" aria-labelledby="daily-meeting-title"><header><div><p className="editorial-kicker">프로젝트 회의 기록</p><h2 id="daily-meeting-title">{meeting ? "회의록 수정" : "회의록 작성"}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header><form onSubmit={submit}>
    <label className="create-field"><span>회의 날짜</span><input type="date" required value={fields.meeting_date} onChange={(event) => setField("meeting_date", event.target.value)} /></label>
    <label className="create-field"><span>회의 제목</span><input required maxLength={200} value={fields.title} onChange={(event) => setField("title", event.target.value)} /></label>
    <label className="create-field is-wide"><span>참석자</span><input maxLength={500} value={fields.attendees_text} onChange={(event) => setField("attendees_text", event.target.value)} placeholder="예: 포켓 김OO, NS 이OO" /></label>
    <label className="create-field is-wide"><span>회의 내용</span><textarea required rows="6" maxLength={10000} value={fields.discussion_text} onChange={(event) => setField("discussion_text", event.target.value)} placeholder="논의한 내용을 항목별로 정리하세요" /></label>
    <label className="create-field is-wide"><span>결정사항</span><textarea rows="4" maxLength={10000} value={fields.decisions_text} onChange={(event) => setField("decisions_text", event.target.value)} placeholder="확정된 내용과 기준을 적어 주세요" /></label>
    <label className="create-field is-wide"><span>후속 업무</span><textarea rows="4" maxLength={10000} value={fields.action_items_text} onChange={(event) => setField("action_items_text", event.target.value)} placeholder="담당자와 기한을 함께 적어 주세요" /></label>
    {role === "pocket" && <FormSelect label="공개 범위" value={fields.visibility_code} onChange={(value) => setField("visibility_code", value)} options={[["PROJECT_TEAM", "프로젝트 팀"], ["CLIENT", "고객 공개"], ["POCKET_ONLY", "포켓 전용"]]} />}
    {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "저장하지 못했습니다."}</span></div>}
    <footer><p>저장·수정 내역은 활동로그에도 기록됩니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.meeting_date || !fields.title.trim() || !fields.discussion_text.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "회의록 저장"}</button></div></footer>
  </form></section></div>;
}

function DailyMeetingsView({ role, meetings, canWrite, onSave }) {
  const [editing, setEditing] = useState(undefined);
  const visibilityLabel = { CLIENT: "고객 공개", PROJECT_TEAM: "프로젝트 팀", POCKET_ONLY: "포켓 전용" };
  return <div className="view-stack daily-meeting-view"><ViewHeader eyebrow="업무 기록" title="데일리 회의록" description="날짜별 논의 내용, 결정사항과 후속 업무를 한곳에 남깁니다.">{canWrite && <button className="primary-button" type="button" onClick={() => setEditing(null)}><Plus size={15} /> 회의록 작성</button>}</ViewHeader>
    <section className="daily-meeting-summary"><article><span>전체 회의록</span><strong>{meetings.length}</strong><small>웹에서 작성한 기록</small></article><article><span>최근 기록</span><strong>{meetings[0]?.date || "-"}</strong><small>{meetings[0]?.authorName || "기록 없음"}</small></article></section>
    {meetings.length ? <section className="daily-meeting-list">{meetings.map((meeting) => <article className="daily-meeting-card panel" key={meeting.id}><header><div className="daily-meeting-date"><CalendarDays size={17} /><span>{meeting.date}</span></div><div><span className="daily-meeting-visibility">{visibilityLabel[meeting.visibilityCode] || meeting.visibilityCode}</span>{canWrite && <button className="icon-button" type="button" onClick={() => setEditing(meeting)} aria-label={`${meeting.title} 수정`}><Pencil size={15} /></button>}</div></header><div className="daily-meeting-title"><h3>{meeting.title}</h3><span>{meeting.authorName}{meeting.attendees ? ` · 참석 ${meeting.attendees}` : ""}</span></div><div className="daily-meeting-sections"><section><h4>회의 내용</h4><p>{meeting.discussion}</p></section>{meeting.decisions && <section><h4>결정사항</h4><p>{meeting.decisions}</p></section>}{meeting.actionItems && <section className="is-action"><h4>후속 업무</h4><p>{meeting.actionItems}</p></section>}</div></article>)}</section> : <EmptyState title="작성된 회의록이 없습니다" description={canWrite ? "오늘 회의 내용을 첫 기록으로 남겨 주세요." : "운영팀이 회의록을 작성하면 이곳에 표시됩니다."} />}
    {editing !== undefined && <DailyMeetingModal meeting={editing} role={role} onClose={() => setEditing(undefined)} onSave={onSave} />}
  </div>;
}

function ContentView({ role, query, contents, onCreate, canWrite }) {
  const [channel, setChannel] = useState("전체");
  const channels = ["전체", ...new Set(contents.map((item) => item.channel))];
  const visibleContents = contents.filter((content) => (channel === "전체" || content.channel === channel) && (!query || `${content.title} ${content.channel}`.toLowerCase().includes(query.toLowerCase())));
  const published = contents.filter((item) => item.status === "완료").length;
  return <div className="view-stack"><ViewHeader eyebrow="콘텐츠 관리" title="콘텐츠" description="채널별 콘텐츠의 기획·검수·게시 상태를 확인합니다.">{role !== "client" && <CreateButton entityType="content" onOpen={onCreate} enabled={canWrite}>콘텐츠 추가</CreateButton>}</ViewHeader><section className="content-summary"><div className="content-summary-title"><span>현재 조회</span><strong>{published} / {contents.length}</strong><small>발행 완료 / 전체 콘텐츠</small></div></section><div className="filter-bar"><ListFilter size={16} /><div className="segmented-control">{channels.map((item) => <button key={item} className={channel === item ? "is-active" : ""} onClick={() => setChannel(item)}>{item}</button>)}</div><span className="result-count">{visibleContents.length}건 표시</span></div>{visibleContents.length ? <div className="content-grid">{visibleContents.map((content) => <article className="content-card" key={content.id}><header><span>{content.channel}</span><i className={statusClass[content.status] || "status status-muted"}>{content.status}</i></header><p>{content.format}</p><h3>{content.title}</h3><footer><span><CalendarDays size={14} /> {content.date}</span><span>{role === "client" ? "포켓컴퍼니" : content.owner}</span></footer></article>)}</div> : <EmptyState title="등록된 콘텐츠가 없습니다" description="선택한 조건에 해당하는 콘텐츠가 없습니다." />}</div>;
}

function KpiSettingsModal({ kpis, onClose, onSave, onArchive }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = kpis.find((item) => item.id === selectedId) || null;
  const [fields, setFields] = useState(() => kpiInitialFields());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const selectKpi = (kpi) => {
    setSelectedId(kpi?.id || null);
    setFields(kpiInitialFields(kpi));
    setError(null);
  };
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const nextFields = kpiSubmissionFields(fields);
      if (!nextFields.metric_name) throw new Error("KPI 이름을 입력해 주세요.");
      await onSave(selected, nextFields);
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  const archive = async () => {
    if (!selected || !window.confirm(`‘${selected.name}’ KPI를 보관할까요?`)) return;
    setError(null);
    setSaving(true);
    try {
      await onArchive(selected);
      onClose();
    } catch (archiveError) {
      setError(archiveError);
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="create-modal kpi-settings-modal" role="dialog" aria-modal="true" aria-labelledby="kpi-settings-title"><header><div><p className="editorial-kicker">Supabase KPI 원장</p><h2 id="kpi-settings-title">핵심 KPI 설정</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header><div className="kpi-settings-layout"><aside><button type="button" className={!selected ? "is-active" : ""} onClick={() => selectKpi(null)}><Plus size={15} /> 새 KPI</button>{kpis.map((kpi) => <button type="button" key={kpi.id} className={selected?.id === kpi.id ? "is-active" : ""} onClick={() => selectKpi(kpi)}><span><strong>{kpi.name}</strong><small>목표 {kpi.target.toLocaleString()}{kpi.unit}</small></span><Pencil size={14} /></button>)}</aside><form onSubmit={submit}>
    <label className="create-field is-wide"><span>KPI 이름</span><input autoFocus required maxLength={100} value={fields.metric_name} onChange={(event) => setField("metric_name", event.target.value)} placeholder="예: 쇼룸 방문 예약" /></label>
    <label className="create-field"><span>목표값</span><input type="number" min="0" step="any" required value={fields.target_value} onChange={(event) => setField("target_value", event.target.value)} placeholder="0" /></label>
    <FormSelect label="단위" value={fields.unit_code} onChange={(value) => setField("unit_code", value)} options={KPI_UNIT_OPTIONS} />
    <FormSelect label="측정 주기" value={fields.period_type_code} onChange={(value) => setField("period_type_code", value)} options={KPI_PERIOD_OPTIONS} />
    <FormSelect label="적용 채널" value={fields.channel_code} onChange={(value) => setField("channel_code", value)} options={KPI_CHANNEL_OPTIONS} />
    <label className="kpi-visibility-field is-wide"><input type="checkbox" checked={fields.customer_visible} onChange={(event) => setField("customer_visible", event.target.checked)} /><span><strong>고객사 화면에 공개</strong><small>끄면 포켓·NS 운영 계정에만 표시됩니다.</small></span></label>
    {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "저장하지 못했습니다."}</span></div>}
    <footer>{selected ? <button className="danger-button" type="button" onClick={archive} disabled={saving}><Trash2 size={14} /> 보관</button> : <p>프로젝트별 KPI로 저장됩니다.</p>}<div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.metric_name.trim() || fields.target_value === ""}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : selected ? "변경 저장" : "KPI 추가"}</button></div></footer>
  </form></div></section></div>;
}

function PerformanceView({ performance, canWrite, onKpiSave, onKpiArchive }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const kpis = performance.items || [];
  const attained = kpis.filter((item) => item.target > 0).map((item) => Math.min(100, item.value / item.target * 100));
  const average = attained.length ? Math.round(attained.reduce((sum, value) => sum + value, 0) / attained.length) : 0;
  const channelTotals = (performance.channels || []).reduce((total, item) => ({ impressions: total.impressions + Number(item.impressions || 0), engagements: total.engagements + Number(item.engagements || 0), clicks: total.clicks + Number(item.clicks || 0), inquiries: total.inquiries + Number(item.inquiries || 0) }), { impressions: 0, engagements: 0, clicks: 0, inquiries: 0 });
  return <div className="view-stack"><ViewHeader eyebrow="성과 요약" title="성과" description="Supabase에 기록된 핵심 KPI를 목표 대비로 확인합니다."><button className="secondary-button" disabled><CalendarDays size={15} /> {performance.range ? `${performance.range.start} — ${performance.range.end}` : "최근 31일"}</button>{canWrite && <button className="primary-button" type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> KPI 설정</button>}</ViewHeader><section className="performance-intro panel"><div><h3>핵심 KPI</h3><p>값이 없는 KPI는 0이 아니라 ‘데이터 없음’으로 구분됩니다.</p></div><div className="performance-score"><strong>{average}<small>%</small></strong><span>평균 달성률</span></div></section>{kpis.length ? <section className="kpi-grid">{kpis.map((kpi) => { const percent = kpi.target ? Math.min(100, Math.round(kpi.value / kpi.target * 100)) : 0; return <article key={kpi.id} className="kpi-card"><header><span>{kpi.state}</span></header><h3>{kpi.name}</h3><div className="kpi-value"><strong>{kpi.value.toLocaleString()}</strong><small>{kpi.unit}</small><span>/ 목표 {kpi.target.toLocaleString()}</span></div><ProgressBar value={percent} color={percent >= 70 ? "var(--success)" : "var(--accent)"} /><footer><span>{percent}% 달성</span><span>{kpi.source}</span></footer></article>; })}</section> : <EmptyState title="설정된 KPI가 없습니다" description={canWrite ? "KPI 설정에서 이 프로젝트의 핵심 목표를 추가해 주세요." : "운영팀이 KPI를 설정하면 이곳에 표시됩니다."} />}{(performance.channels || []).length > 0 && <section className="panel funnel-panel"><div className="panel-heading"><div><h3>채널 반응 흐름</h3></div><span className="panel-note">선택 기간 합계</span></div><div className="funnel-flow">{[{ label: "노출", value: channelTotals.impressions }, { label: "반응", value: channelTotals.engagements }, { label: "클릭", value: channelTotals.clicks }, { label: "문의", value: channelTotals.inquiries }].map((item, index) => <article key={item.label}><strong>{item.value.toLocaleString()}</strong><small>{item.label}</small>{index < 3 && <ArrowRight size={17} />}</article>)}</div></section>}{settingsOpen && <KpiSettingsModal kpis={kpis} onClose={() => setSettingsOpen(false)} onSave={onKpiSave} onArchive={onKpiArchive} />}</div>;
}

function TrackingTrendChart({ rows, metric }) {
  const series = dailyMetricSeries(rows, metric);
  if (!series.length) return <EmptyState title="추이 데이터가 없습니다" description="12_성과일별 원장에 날짜별 성과를 입력하면 선 그래프가 표시됩니다." />;
  const width = 760;
  const height = 230;
  const horizontalPadding = 24;
  const verticalPadding = 28;
  const maximum = Math.max(...series.map((item) => item.value), 1);
  const points = series.map((item, index) => ({
    ...item,
    x: horizontalPadding + (series.length === 1 ? (width - horizontalPadding * 2) / 2 : index / (series.length - 1) * (width - horizontalPadding * 2)),
    y: height - verticalPadding - item.value / maximum * (height - verticalPadding * 2),
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 5)) === 0);
  return <div className="tracking-chart-wrap"><svg className="tracking-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${TRACKING_METRICS.find((item) => item.id === metric)?.label || metric} 일별 추이`}><line x1={horizontalPadding} y1={height - verticalPadding} x2={width - horizontalPadding} y2={height - verticalPadding} className="tracking-chart-axis" /><polyline points={line} className="tracking-chart-line" />{points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="3.5" className="tracking-chart-point"><title>{point.date} · {point.value.toLocaleString()}</title></circle>)}{labels.map((point) => <text key={`label-${point.date}`} x={point.x} y={height - 6} textAnchor="middle">{point.date.slice(5).replace("-", ".")}</text>)}</svg><div className="tracking-chart-scale"><strong>{maximum.toLocaleString()}</strong><span>0</span></div></div>;
}

function TrackingView({ tracking }) {
  const [metric, setMetric] = useState("impressions");
  const totals = tracking.totals || {};
  const funnel = trackingFunnel(totals);
  const signals = trackingSignals({ totals, channels: tracking.channels || [] });
  const firstStage = funnel[0]?.value || 0;
  const latestPerformanceDate = (tracking.daily || []).at(-1)?.date || null;
  const dataAvailable = tracking.dataAvailable !== false && (tracking.daily || []).length > 0;
  const metricValue = (value, suffix = "") => dataAvailable ? `${Number(value || 0).toLocaleString()}${suffix}` : "—";
  const formatMoney = (value) => `${Math.round(Number(value || 0)).toLocaleString()}원`;
  return <div className="view-stack tracking-view"><ViewHeader eyebrow="Outcome tracking" title="성과 추적" description="실행이 콘텐츠 발행과 실제 반응·문의로 이어지는지 확인합니다."><button className="secondary-button" disabled><CalendarDays size={15} /> {tracking.range ? `${tracking.range.start} — ${tracking.range.end}` : "최근 90일"}</button></ViewHeader>
    <section className={`tracking-source-notice ${dataAvailable ? "is-ready" : "is-empty"}`}><span /><div><strong>{dataAvailable ? "Google Sheets 성과 원장 연결됨" : "Google Sheets 연결됨 · 성과 데이터 0건"}</strong><p>{dataAvailable ? `${tracking.source || "12_성과일별"}에서 ${tracking.daily.length}일·${tracking.channels.length}개 채널을 집계했습니다.` : `${tracking.source || "12_성과일별"}에 현재 프로젝트의 일별 성과 행이 없습니다. 값이 입력되면 이 화면에 바로 집계됩니다.`}</p></div></section>
    <section className="tracking-score-grid">
      <article><span className="tracking-score-icon"><BarChart3 size={17} /></span><div><small>총 광고비</small><strong>{dataAvailable ? formatMoney(totals.spend) : "—"}</strong><p>{dataAvailable ? "선택 기간 합계" : "데이터 없음"}</p></div></article>
      <article><span className="tracking-score-icon is-purple"><Activity size={17} /></span><div><small>총 노출</small><strong>{metricValue(totals.impressions)}</strong><p>{dataAvailable ? "매체 일별 원장 합계" : "데이터 없음"}</p></div></article>
      <article><span className="tracking-score-icon is-cyan"><MousePointerClick size={17} /></span><div><small>클릭</small><strong>{metricValue(totals.clicks)}</strong><p>{dataAvailable ? "선택 기간 합계" : "데이터 없음"}</p></div></article>
      <article><span className="tracking-score-icon is-green"><TrendingUp size={17} /></span><div><small>문의·전환</small><strong>{dataAvailable ? <>{metricValue(totals.inquiries)}<em> / {metricValue(totals.conversions)}</em></> : "—"}</strong><p>{dataAvailable ? "문의 / 최종 전환" : "데이터 없음"}</p></div></article>
    </section>
    <section className="tracking-main-grid">
      <article className="panel tracking-funnel-panel"><div className="panel-heading"><div><h3>성과 흐름</h3><p>각 단계는 직전 단계 대비 전환율입니다.</p></div><span className="panel-note">12_성과일별 합계</span></div>{firstStage > 0 ? <div className="tracking-funnel-list">{funnel.map((stage, index) => <div className="tracking-funnel-stage" key={stage.id}><div className="tracking-funnel-label"><span>{index + 1}</span><strong>{stage.label}</strong><b>{stage.value.toLocaleString()}</b></div><div className="tracking-funnel-bar"><i style={{ width: `${Math.max(3, stage.value / firstStage * 100)}%` }} /></div><div className="tracking-funnel-rate">{stage.conversionRate === null ? "시작 단계" : `${stage.conversionRate.toFixed(1)}% 전환`}</div></div>)}</div> : <EmptyState title="성과 흐름 데이터가 없습니다" description="노출·반응·클릭·문의가 기록되면 단계별 전환을 계산합니다." />}</article>
      <article className="panel tracking-signal-panel"><div className="panel-heading"><div><h3>현재 성과 신호</h3><p>고정 문구가 아닌 선택 기간의 원장값으로 판정합니다.</p></div></div>{signals.length ? <div className="tracking-signal-list">{signals.map((signal) => <div key={signal.id} className={`tracking-signal is-${signal.tone}`}><span /><div><small>{signal.label}</small><strong>{signal.value}</strong><p>{signal.detail}</p></div></div>)}</div> : <EmptyState title="판정할 데이터가 없습니다" description="성과와 실행 데이터가 쌓이면 병목과 기여 채널을 표시합니다." />}</article>
    </section>
    <section className="panel tracking-trend-panel"><div className="panel-heading"><div><h3>일별 성과 추이</h3><p>급증·하락이 발생한 날짜를 확인합니다.</p></div><div className="tracking-metric-tabs">{TRACKING_METRICS.map((item) => <button type="button" key={item.id} className={metric === item.id ? "is-active" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div></div><TrackingTrendChart rows={tracking.daily || []} metric={metric} /></section>
    <section className="tracking-bottom-grid"><article className="panel tracking-channel-panel"><div className="panel-heading"><div><h3>채널별 성과 기여</h3><p>비용과 문의 성과를 같은 기준으로 비교합니다.</p></div></div>{(tracking.channels || []).length ? <div className="tracking-table-scroll"><table className="tracking-channel-table"><thead><tr><th>채널</th><th>광고비</th><th>노출</th><th>반응</th><th>클릭</th><th>CTR</th><th>문의</th><th>문의당 비용</th></tr></thead><tbody>{tracking.channels.map((channel) => { const ctr = channel.impressions ? channel.clicks / channel.impressions * 100 : null; const cpl = channel.inquiries ? channel.spend / channel.inquiries : null; return <tr key={channel.channelCode}><td><span className="tracking-channel-dot" />{channel.label}</td><td>{formatMoney(channel.spend)}</td><td>{channel.impressions.toLocaleString()}</td><td>{channel.engagements.toLocaleString()}</td><td>{channel.clicks.toLocaleString()}</td><td>{ctr === null ? "-" : `${ctr.toFixed(2)}%`}</td><td><strong>{channel.inquiries.toLocaleString()}</strong></td><td>{cpl === null ? "-" : formatMoney(cpl)}</td></tr>; })}</tbody></table></div> : <EmptyState title="채널별 데이터가 없습니다" description="성과일별 원장에 채널 코드와 실적을 입력하면 비교표가 표시됩니다." />}</article>
      <article className="panel tracking-goal-panel"><div className="panel-heading"><div><h3>데이터 상태</h3><p>화면에 사용된 Google Sheets 원장 범위입니다.</p></div></div><div className="tracking-data-state"><div><span>원장</span><strong>12_성과일별</strong></div><div><span>최신 실적일</span><strong>{latestPerformanceDate || "데이터 없음"}</strong></div><div><span>기록 일수</span><strong>{(tracking.daily || []).length.toLocaleString()}일</strong></div><div><span>집계 채널</span><strong>{(tracking.channels || []).length.toLocaleString()}개</strong></div></div></article></section>
  </div>;
}

function AccessAccountModal({ account, projects, onClose, onSave, canDisableAccount }) {
  const firstAccess = account?.accesses?.[0] || null;
  const [fields, setFields] = useState(() => ({
    account: account?.account || "",
    displayName: account?.displayName || "",
    accessCode: "",
    projectId: firstAccess?.projectId || projects[0]?.id || "",
    membershipId: firstAccess?.id || "",
    allowedPages: normalizeAllowedPages(firstAccess?.allowedPages?.length ? firstAccess.allowedPages : ACCESS_PAGE_OPTIONS.map((page) => page.id)),
    enabled: account?.enabled !== false,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const pageGroups = [
    {
      id: "main",
      label: "기본 메뉴",
      description: "프로젝트 공통 정보와 성과·기록 화면",
      pages: ACCESS_PAGE_OPTIONS.filter((page) => !PROJECT_NAVIGATION_GROUP.pageIds.includes(page.id)),
    },
    {
      id: PROJECT_NAVIGATION_GROUP.id,
      label: PROJECT_NAVIGATION_GROUP.label,
      description: "왼쪽 프로젝트 메뉴에 표시할 하위 화면",
      pages: ACCESS_PAGE_OPTIONS.filter((page) => PROJECT_NAVIGATION_GROUP.pageIds.includes(page.id)),
    },
  ];
  const setField = (key, value) => setFields((current) => ({ ...current, [key]: value }));
  const togglePage = (page) => setFields((current) => ({
    ...current,
    allowedPages: current.allowedPages.includes(page)
      ? current.allowedPages.filter((item) => item !== page)
      : normalizeAllowedPages([...current.allowedPages, page]),
  }));
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!account && !fields.accessCode) return setError(new Error("신규 계정의 임시 비밀번호를 입력해 주세요."));
    if (!fields.allowedPages.length) return setError(new Error("접근 가능한 페이지를 하나 이상 선택해 주세요."));
    setSaving(true);
    try {
      await onSave(accountSubmission(fields));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  const disable = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...accountSubmission(fields), operation: "DISABLE", enabled: false });
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  const removeAccess = async (access) => {
    if (!window.confirm(`${access.projectName} 접근 권한을 제거할까요? 계정의 다른 프로젝트 권한은 유지됩니다.`)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(removeAccessSubmission(fields, access));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="create-modal access-account-modal" role="dialog" aria-modal="true" aria-labelledby="access-account-title"><header><div><p className="editorial-kicker">Supabase 계정·권한 원장</p><h2 id="access-account-title">{account ? "고객사 계정 관리" : "고객사 계정 생성"}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header><form onSubmit={submit}>
    <div className="access-form-grid"><label className="create-field"><span>로그인 아이디</span><input value={fields.account} onChange={(event) => setField("account", event.target.value)} placeholder="예: client-account" disabled={Boolean(account)} required /></label><label className="create-field"><span>표시 이름</span><input value={fields.displayName} onChange={(event) => setField("displayName", event.target.value)} placeholder="예: 고객사 담당자" required /></label><label className="create-field"><span>{account ? "새 비밀번호 · 변경할 때만" : "임시 비밀번호"}</span><input type="password" autoComplete="new-password" value={fields.accessCode} onChange={(event) => setField("accessCode", event.target.value)} placeholder="8자 이상" required={!account} /></label><FormSelect label="계정 상태" value={fields.enabled ? "ACTIVE" : "DISABLED"} onChange={(value) => setField("enabled", value === "ACTIVE")} options={[["ACTIVE", "사용 중"], ["DISABLED", "사용 중지"]]} /><FormSelect label="접근 프로젝트" value={fields.projectId} onChange={(value) => setField("projectId", value)} options={projects.map((project) => [project.id, project.name])} /></div>
    <fieldset className="access-page-fieldset"><legend>접근 가능한 페이지</legend><p>체크한 메뉴만 고객사 화면에 표시됩니다. 프로젝트의 업무·진행상황·데일리 회의록은 각각 따로 지정할 수 있습니다.</p><div className="access-page-groups">{pageGroups.map((group) => <section className="access-page-group" key={group.id}><header><strong>{group.label}</strong><small>{group.description}</small></header><div className="access-page-options">{group.pages.map((page) => <label key={page.id}><input type="checkbox" checked={fields.allowedPages.includes(page.id)} onChange={() => togglePage(page.id)} /><span><strong>{page.label}</strong><small>{page.description}</small></span></label>)}</div></section>)}</div></fieldset>
    {account?.accesses?.length > 0 && <section className="access-current-projects"><strong>현재 프로젝트 권한</strong><div>{account.accesses.map((access) => <article key={access.id}><span><b>{access.projectName}</b><small>{access.allowedPages.length}개 페이지</small></span><button type="button" className="danger-button" disabled={saving} onClick={() => removeAccess(access)}>이 프로젝트 권한 제거</button></article>)}</div></section>}
    {error && <div className="form-error"><AlertCircle size={14} />{error.message}</div>}
    <footer>{account && canDisableAccount && <button type="button" className="danger-button" onClick={disable} disabled={saving || !fields.projectId}>계정 비활성화</button>}<span /><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.account.trim() || !fields.displayName.trim() || !fields.projectId || !fields.allowedPages.length}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "권한 저장"}</button></footer>
  </form></section></div>;
}

function PermissionsView({ access, onSave, role }) {
  const [editing, setEditing] = useState(undefined);
  const accounts = access.accounts || [];
  const pageLabel = Object.fromEntries(ACCESS_PAGE_OPTIONS.map((page) => [page.id, page.label]));
  const activeCount = accounts.filter((account) => account.enabled).length;
  return <div className="view-stack"><ViewHeader eyebrow="고객 계정 관리" title="권한 관리" description="고객사 계정을 만들고 프로젝트별로 볼 수 있는 페이지를 지정합니다."><button className="primary-button" type="button" onClick={() => setEditing(null)}><Plus size={15} /> 고객사 계정 생성</button></ViewHeader><section className="access-summary"><article><span>고객 계정</span><strong>{accounts.length}</strong></article><article><span>활성 계정</span><strong>{activeCount}</strong></article><article><span>배정 프로젝트</span><strong>{access.projects?.length || 0}</strong></article></section><section className="panel access-panel"><div className="panel-heading"><div><h3>계정별 접근 범위</h3><p>비밀번호 원문은 저장하거나 다시 표시하지 않습니다.</p></div></div>{accounts.length ? <div className="access-account-list">{accounts.map((account) => {
    const primaryAccess = account.accesses?.[0];
    return <button type="button" key={account.id} className="access-account-row" onClick={() => setEditing(account)}><span className={`access-account-state ${account.enabled ? "is-active" : ""}`}><ShieldCheck size={16} /></span><span className="access-account-identity"><strong>{account.displayName}</strong><small>{account.account}</small></span><span className="access-account-project"><small>프로젝트</small><strong>{primaryAccess?.projectName || "미배정"}</strong></span><span className="access-page-badges">{(primaryAccess?.allowedPages || []).map((page) => <i key={page}>{pageLabel[page] || page}</i>)}</span><span className={`status ${account.enabled ? "status-success" : "status-muted"}`}>{account.enabled ? "사용 중" : "중지"}</span><Pencil size={15} /></button>;
  })}</div> : <EmptyState title="등록된 고객사 계정이 없습니다" description="고객사 계정 생성 버튼에서 첫 계정을 추가하세요." />}</section>{editing !== undefined && <AccessAccountModal account={editing} projects={access.projects || []} onClose={() => setEditing(undefined)} onSave={onSave} canDisableAccount={role === "pocket"} />}</div>;
}

function DetailLogView({ role, activities }) {
  return <div className="view-stack"><ViewHeader eyebrow="Project history" title="세부 로그" description="업무 로그에서 생략한 시스템·기술 이력까지 시간순으로 확인합니다." /><section className="panel detail-log-panel"><div className="panel-heading"><div><h3>전체 변경 이력</h3><p>내부 ID와 원본 감사 정보를 포함한 확정 활동입니다.</p></div><Activity size={17} /></div>{activities.length ? <div className="activity-timeline">{activities.map((item) => <article key={item.id}><span /><div><strong>{item.taskTitle || item.title}</strong><p>{item.action} · {item.meta}</p>{role !== "client" && <small>{[item.entityId && `ID ${item.entityId}`, item.actor && `처리 ${item.actor}`, item.internalMeta].filter(Boolean).join(" · ")}</small>}</div></article>)}</div> : <EmptyState title="기록된 활동이 없습니다" description="웹에서 업무나 회의록이 추가·수정되면 여기에 표시됩니다." />}</section></div>;
}

const PLAN_ALLOWED_TAGS = new Set([
  "a", "article", "b", "blockquote", "br", "dd", "div", "dl", "dt", "em", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "section", "small", "span",
  "strong", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);
const PLAN_BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option", "svg", "math"]);

function sanitizePlanHtml(value) {
  if (!value || typeof window === "undefined" || typeof window.DOMParser !== "function") return "";
  const documentNode = new window.DOMParser().parseFromString(`<div>${String(value)}</div>`, "text/html");
  const root = documentNode.body.firstElementChild;
  if (!root) return "";

  Array.from(root.querySelectorAll("*")).forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (PLAN_BLOCKED_TAGS.has(tagName)) {
      element.remove();
      return;
    }
    if (!PLAN_ALLOWED_TAGS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const allowedTableAttribute = ["colspan", "rowspan", "scope"].includes(name);
      if (tagName === "a" && name === "href") {
        const href = attribute.value.trim();
        if (!/^(https?:|mailto:|#)/i.test(href)) element.removeAttribute(attribute.name);
        return;
      }
      if (tagName === "a" && name === "target") {
        if (attribute.value !== "_blank") element.removeAttribute(attribute.name);
        return;
      }
      if (!allowedTableAttribute) element.removeAttribute(attribute.name);
    });
    if (tagName === "a" && element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
  });

  return root.innerHTML;
}

function isRecentPlanSection(value, now = Date.now()) {
  if (!value) return false;
  const updatedAt = new Date(value).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  const age = now - updatedAt;
  return age >= 0 && age <= 24 * 60 * 60 * 1000;
}

function PlanView({ plan, project, planVariant }) {
  const sections = plan.sections || [];
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || "");

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) setActiveSectionId(sections[0]?.id || "");
  }, [sections, activeSectionId]);

  const activeSection = sections.find((section) => section.id === activeSectionId) || sections[0] || null;
  const activeSectionIsNew = isRecentPlanSection(activeSection?.updatedAt);
  const safeBodyHtml = useMemo(() => sanitizePlanHtml(activeSection?.bodyHtml), [activeSection?.bodyHtml]);
  const planProjectName = plan.title || plan.project?.project_name || plan.project?.projectName || plan.project?.name || project.name;

  const isInternal = planVariant === "internal";

  return <div className="view-stack plan-view">
    <section className="plan-summary panel">
      <div className="plan-summary-copy"><span>{isInternal ? "내부 실행계획" : "클라이언트 공유용"}</span><h2>{planProjectName}</h2><p>{plan.summary || (isInternal ? "실행 담당자가 사용하는 세부 범위와 단계별 계획을 확인합니다." : "고객사와 합의한 실행 범위와 단계별 계획을 확인합니다.")}</p></div>
      <dl><div><dt>계획 구간</dt><dd>{sections.length}개 섹션</dd></div><div><dt>기준 버전</dt><dd>{plan.sourceVersion || "현재 승인본"}</dd></div><div><dt>최근 반영</dt><dd>{plan.updatedAtLabel}</dd></div></dl>
    </section>
    {sections.length ? <section className="plan-layout">
      <nav className="plan-section-nav panel" aria-label="실행계획 목차">
        <span>목차</span>
        {sections.map((section) => <button key={section.id} type="button" className={section.id === activeSection?.id ? "is-active" : ""} onClick={() => setActiveSectionId(section.id)} aria-current={section.id === activeSection?.id ? "page" : undefined}><strong>{section.title}</strong>{isRecentPlanSection(section.updatedAt) && <span className="plan-new-badge" title="24시간 이내 변경된 섹션">신규</span>}</button>)}
      </nav>
      <article className="plan-document panel">
        <header><div><span>{activeSection?.code || "실행계획"}</span><h3>{activeSection?.title}{activeSectionIsNew && <span className="plan-new-badge" title="24시간 이내 변경된 섹션">신규</span>}</h3></div><small>{sections.findIndex((section) => section.id === activeSection?.id) + 1} / {sections.length}</small></header>
        <div className="plan-document-body" dangerouslySetInnerHTML={{ __html: safeBodyHtml }} />
      </article>
    </section> : <EmptyState title={isInternal ? "등록된 내부 실행계획이 없습니다" : "공유된 실행계획이 없습니다"} description={isInternal ? "내부 실행계획이 등록되면 이곳에 표시됩니다." : "클라이언트 공유용 승인본이 등록되면 이곳에 표시됩니다."} />}
  </div>;
}

export function ProjectProgressView(props) {
  const scheduleProject = { ...props.project, ...(props.taskPage.project || {}) };
  return <Suspense fallback={<LoadingState label="진행상황 화면을 준비하고 있습니다." />}><ProgressView {...props} schedule={<TaskScheduleTimeline
    key={scheduleProject.id} tasks={props.taskPage.items || []} issues={[]} project={scheduleProject}
    displayMode="gantt" summaryOnly canWrite={false} canWriteIssues={false} canEditProject={false}
    showOwners={props.role !== "client"}
  />} /></Suspense>;
}

export function ProjectClientProgressView({ project, taskPage }) {
  const scheduleProject = { ...project, ...(taskPage.project || {}) };
  return <Suspense fallback={<LoadingState label="고객용 진행상황을 준비하고 있습니다." />}><ClientProgressView project={project} taskPage={taskPage} schedule={<TaskScheduleTimeline
    key={scheduleProject.id} tasks={taskPage.items || []} issues={[]} project={scheduleProject}
    displayMode="gantt" summaryOnly canWrite={false} canWriteIssues={false} canEditProject={false} showOwners={false}
  />} /></Suspense>;
}

function AppContent({ view, planVariant, project, role, search, setView, pageState, taskActivityState, onLoadTaskActivity, onRetry, onCreate, onTaskUpdate, onTaskArchive, onTaskBatchUpdate, onProjectUpdate, onIssueCreate, onIssueUpdate, onIssueArchive, onDailyMeetingSave, onCredentialSave, onCredentialArchive, onCredentialReveal, onKpiSave, onKpiArchive, onAccessSave, onOpenProject, canWrite, source, actorName }) {
  if (pageState.status === "loading" && !pageState.data) return <LoadingState />;
  if (pageState.status === "error" && !pageState.data) return <ErrorState error={pageState.error} onRetry={onRetry} />;
  const data = pageState.data || {};
  if (view === "portfolio") return role !== "client" ? <Suspense fallback={<LoadingState label="통합 관리 화면을 준비하고 있습니다." />}><OperationsDashboardView dashboard={data} actorName={actorName} canWrite={canWrite} onIssueCreate={onIssueCreate} onIssueUpdate={onIssueUpdate} onIssueArchive={onIssueArchive} onOpenProject={onOpenProject} onLoadWeek={(startDate, endDate) => source.operationsDashboard({ startDate, endDate }).then(operationsDashboardViewModel)} /></Suspense> : <ErrorState error={new Error("내부 운영 계정만 접근할 수 있습니다.")} />;
  if (view === "client-progress") return <ProjectClientProgressView key={project.id} project={project} taskPage={data} />;
  if (view === "progress") return role === "client" ? <LoadingState label="고객용 진행상황으로 이동합니다." /> : <ProjectProgressView key={project.id} project={project} role={role} taskPage={data} source={source} actorName={actorName} canWrite={canWrite} onIssueCreate={onIssueCreate} onIssueUpdate={onIssueUpdate} onIssueArchive={onIssueArchive} onNavigate={setView} />;
  if (view === "plan") return <PlanView plan={data} project={project} planVariant={planVariant} />;
  if (view === "tasks" || view === "schedule") return <TasksView role={role} query={search} taskPage={{ ...data, project: { id: project.id, clientId: project.clientId, clientName: project.clientName, name: project.name, permissionCode: project.permissionCode, allowedPages: project.allowedPages, phaseCode: project.phaseCode, phase: project.phase, startDate: project.startDate, endDate: project.endDate, rowVersion: project.rowVersion, ...(data.project || {}) } }} activityState={taskActivityState} onLoadActivity={onLoadTaskActivity} onCreate={onCreate} actorName={actorName} onUpdate={onTaskUpdate} onArchive={onTaskArchive} onBatchUpdate={onTaskBatchUpdate} onProjectUpdate={onProjectUpdate} onIssueCreate={onIssueCreate} onIssueUpdate={onIssueUpdate} onIssueArchive={onIssueArchive} canWrite={canWrite} initialSection="schedule" />;
  if (view === "daily") return role !== "client" && Array.isArray(data.projects)
    ? <Suspense fallback={<LoadingState label="전체 업체 회의록을 준비하고 있습니다." />}><WorkspaceDailyMeetingsView dashboard={data} canWrite={canWrite} onSave={onDailyMeetingSave} onLoadWeek={(startDate, endDate) => source.operationsDashboard({ startDate, endDate }).then(operationsDashboardViewModel)} /></Suspense>
    : <DailyMeetingsView role={role} meetings={data.items || []} canWrite={canWrite && role !== "client"} onSave={onDailyMeetingSave} />;
  if (view === "credentials") return role !== "client" ? <Suspense fallback={<LoadingState label="아이디 관리대장 화면을 준비하고 있습니다." />}><CredentialLedgerView key={project.id} project={project} credentials={data.items || []} query={search} canWrite={canWrite} onSave={onCredentialSave} onArchive={onCredentialArchive} onReveal={onCredentialReveal} /></Suspense> : <ErrorState error={new Error("내부 운영 계정만 접근할 수 있습니다.")} />;
  if (view === "content") return <ContentView role={role} query={search} contents={data.items || []} onCreate={onCreate} canWrite={canWrite} />;
  if (view === "tracking") return <TrackingView tracking={data} />;
  if (view === "performance") return <PerformanceView performance={data} canWrite={canWrite && role !== "client"} onKpiSave={onKpiSave} onKpiArchive={onKpiArchive} />;
  if (view === "permissions") return canManageClientAccess(role) ? <PermissionsView access={data} onSave={onAccessSave} role={role} /> : <ErrorState error={new Error("내부 운영 계정만 접근할 수 있습니다.")} />;
  if (view === "files") return <DetailLogView role={role} activities={data.activities?.items || []} />;
  return <OverviewView project={data.project || project} role={role} activities={data.activities || []} onNavigate={setView} />;
}

const blankPage = { status: "idle", data: null, error: null, resource: null, projectId: null };
const blankTaskActivity = { status: "idle", data: null, error: null, projectId: null, loadingMore: false };
const RESOURCE_CACHE_TTL_MS = 10 * 60_000;
const BOOTSTRAP_SESSION_CACHE_KEY = "pocket-marketing-hub.bootstrap.v2";
const PERSISTED_RESOURCES = new Set(["tasks", "plan-client", "plan-internal", "daily", "performance"]);
let pendingBootstrapCacheWrite = null;

function serverInitialView(view) {
  return view === "schedule" ? "tasks" : view;
}

function readBootstrapSessionCache(session) {
  try {
    const raw = globalThis.sessionStorage?.getItem(BOOTSTRAP_SESSION_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (!cached?.envelope || !cached?.userId || cached.userId !== session?.user?.userId) return null;
    if (Date.now() - Number(cached.cachedAt || 0) > RESOURCE_CACHE_TTL_MS) return null;
    return cached.envelope;
  } catch {
    return null;
  }
}

function writeBootstrapSessionCache(session, envelope) {
  try {
    if (!session?.user?.userId || !envelope) return;
    if (pendingBootstrapCacheWrite !== null) {
      if (typeof globalThis.cancelIdleCallback === "function") globalThis.cancelIdleCallback(pendingBootstrapCacheWrite);
      else globalThis.clearTimeout(pendingBootstrapCacheWrite);
    }
    const commit = () => {
      pendingBootstrapCacheWrite = null;
      try {
        globalThis.sessionStorage?.setItem(BOOTSTRAP_SESSION_CACHE_KEY, JSON.stringify({
          userId: session.user.userId,
          cachedAt: Date.now(),
          envelope,
        }));
      } catch {}
    };
    pendingBootstrapCacheWrite = typeof globalThis.requestIdleCallback === "function"
      ? globalThis.requestIdleCallback(commit, { timeout: 600 })
      : globalThis.setTimeout(commit, 0);
  } catch {}
}

function clearBootstrapSessionCache() {
  try {
    if (pendingBootstrapCacheWrite !== null) {
      if (typeof globalThis.cancelIdleCallback === "function") globalThis.cancelIdleCallback(pendingBootstrapCacheWrite);
      else globalThis.clearTimeout(pendingBootstrapCacheWrite);
      pendingBootstrapCacheWrite = null;
    }
    globalThis.sessionStorage?.removeItem(BOOTSTRAP_SESSION_CACHE_KEY);
  } catch {}
}

export function App() {
  const [{ source, error: configError }] = useState(sourceFactory);
  const [sourceState, setSourceState] = useState(() => source?.getState() || { mode: "live", phase: "error", error: configError });
  // A valid server-issued preview session is safe to reuse. The backend still
  // revalidates its project scope on every read, while the browser avoids an
  // unnecessary session round trip on each refresh.
  const [session, setSession] = useState(() => source?.getSession() || null);
  const [loginError, setLoginError] = useState(null);
  const [bootstrapState, setBootstrapState] = useState(blankPage);
  const [overviewState, setOverviewState] = useState(blankPage);
  const [resourceState, setResourceState] = useState(blankPage);
  const [taskActivityState, setTaskActivityState] = useState(blankTaskActivity);
  const [activeClient, setActiveClient] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const initialLocation = typeof window !== "undefined" ? parseViewLocation(window.location.hash) : { view: "overview", planVariant: DEFAULT_PLAN_VARIANT };
  const [view, setView] = useState(initialLocation.view);
  const [planVariant, setPlanVariant] = useState(initialLocation.planVariant);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(true);
  const [bootstrapRetryKey, setBootstrapRetryKey] = useState(0);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);
  const [createEntity, setCreateEntity] = useState(null);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [quoteImportOpen, setQuoteImportOpen] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [sheetSaveLock, setSheetSaveLock] = useState({ visible: false, label: "" });
  const sheetWriteCountRef = useRef(0);
  const sheetSaveShownAtRef = useRef(0);
  const sheetSaveReleaseTimerRef = useRef(null);
  const activeProjectIdRef = useRef(null);
  const pageRefreshKeyRef = useRef(pageRefreshKey);
  const initializationRequestRef = useRef(null);
  const resourceCacheRef = useRef(new Map());
  const resourceRequestRef = useRef(new Map());
  const resourceCacheEpochRef = useRef(0);
  const resourceVersionsRef = useRef(new Map());
  const taskActivityRequestRef = useRef(null);
  const live = Boolean(source);
  const compactViewport = useMediaQuery("(max-width: 900px)");
  const actorRole = bootstrapState.data?.actor?.role || "client";
  const navigation = getNavigationPresentation({
    role: actorRole,
    compactViewport,
    drawerOpen: sidebarOpen,
    desktopCollapsed: desktopSidebarCollapsed,
  });
  const authorizedPlanVariant = planVariant;
  const activeResource = viewResourceKey(view, authorizedPlanVariant);
  const resourceProjectId = view === "portfolio" || (view === "daily" && actorRole !== "client") ? "workspace" : activeProjectId;
  pageRefreshKeyRef.current = pageRefreshKey;

  const runSheetWrite = useCallback(async (label, operation) => {
    if (sheetSaveReleaseTimerRef.current !== null) {
      window.clearTimeout(sheetSaveReleaseTimerRef.current);
      sheetSaveReleaseTimerRef.current = null;
    }
    const startsBatch = sheetWriteCountRef.current === 0;
    sheetWriteCountRef.current += 1;
    if (startsBatch) sheetSaveShownAtRef.current = Date.now();
    setSheetSaveLock((current) => ({
      visible: true,
      label: startsBatch ? label : current.label || label,
    }));
    try {
      return await operation();
    } finally {
      sheetWriteCountRef.current = Math.max(0, sheetWriteCountRef.current - 1);
      if (sheetWriteCountRef.current === 0) {
        const elapsed = Date.now() - sheetSaveShownAtRef.current;
        const releaseDelay = Math.max(SAVE_OVERLAY_COALESCE_MS, SAVE_OVERLAY_MIN_MS - elapsed);
        sheetSaveReleaseTimerRef.current = window.setTimeout(() => {
          sheetSaveReleaseTimerRef.current = null;
          if (sheetWriteCountRef.current === 0) {
            setSheetSaveLock({ visible: false, label: "" });
          }
        }, releaseDelay);
      }
    }
  }, []);
  const mutateWithSaveLock = useCallback((label, options) => runSheetWrite(label, () => source.mutate(options)), [runSheetWrite, source]);
  const mutateBatchWithSaveLock = useCallback((label, options) => runSheetWrite(label, () => source.mutateBatch(options)), [runSheetWrite, source]);
  const accessMutateWithSaveLock = useCallback((label, options) => runSheetWrite(label, () => source.accessAdminMutate(options)), [runSheetWrite, source]);

  useEffect(() => source?.subscribe(setSourceState), [source]);
  useEffect(() => () => {
    if (sheetSaveReleaseTimerRef.current !== null) {
      window.clearTimeout(sheetSaveReleaseTimerRef.current);
    }
  }, []);
  useEffect(() => {
    if (live && session && sourceState.user === null && sourceState.error?.code === "unauthorized" && source.config.loginEnabled) {
      setSession(null);
    }
  }, [live, session, source, sourceState.user, sourceState.error]);
  useEffect(() => {
    if (!saveNotice) return undefined;
    const timeout = window.setTimeout(() => setSaveNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [saveNotice]);
  useEffect(() => {
    if (!navigation.usesDrawer && sidebarOpen) setSidebarOpen(false);
  }, [navigation.usesDrawer, sidebarOpen]);
  useEffect(() => {
    if (!navigation.isDrawerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigation.isDrawerOpen]);
  useEffect(() => {
    if (bootstrapState.status !== "ready" || actorRole !== "client" || !activeProjectId) return;
    const allowedPages = bootstrapState.data?.projects?.[activeProjectId]?.allowedPages || [];
    if (isViewAllowed(view, allowedPages)) return;
    const fallbackView = view === "progress" && isViewAllowed("client-progress", allowedPages) ? "client-progress" : firstAllowedView(allowedPages);
    setView(fallbackView);
    setPlanVariant(DEFAULT_PLAN_VARIANT);
  }, [bootstrapState.status, bootstrapState.data, actorRole, activeProjectId, view]);
  useEffect(() => {
    if (bootstrapState.status !== "ready" || !activeProjectId || view !== "overview") return;
    const allowedPages = bootstrapState.data?.projects?.[activeProjectId]?.allowedPages || [];
    if (actorRole !== "client" || isViewAllowed("schedule", allowedPages)) setView("schedule");
  }, [bootstrapState.status, bootstrapState.data, actorRole, activeProjectId, view]);

  const applyBootstrapEnvelope = useCallback((envelope) => {
    const data = bootstrapViewModel(envelope);
    writeBootstrapSessionCache(source?.getSession(), envelope);
    const currentProjectId = activeProjectIdRef.current;
    const nextProjectId = data.projects[currentProjectId]
      ? currentProjectId
      : data.clients[0]?.projectId || Object.keys(data.projects)[0] || null;
    setBootstrapState({ status: "ready", data, error: null });
    setActiveClient((current) => data.clients.some((item) => item.id === current) ? current : data.clients[0]?.id || null);
    setActiveProjectId(nextProjectId);
    activeProjectIdRef.current = nextProjectId;

    setOverviewState(blankPage);
    setResourceState(blankPage);
    setTaskActivityState(blankTaskActivity);
    taskActivityRequestRef.current = null;
    resourceCacheEpochRef.current += 1;
    resourceCacheRef.current.clear();
    resourceRequestRef.current.clear();
    resourceVersionsRef.current.clear();
    if (data.initial?.projectId === nextProjectId) {
      const initialState = {
        status: "ready",
        data: data.initial.data,
        error: null,
        resource: data.initial.view,
        projectId: nextProjectId,
        refreshKey: pageRefreshKeyRef.current,
      };
      if (data.initial.view === "overview") {
        setOverviewState(initialState);
      } else {
        const initialCacheKey = `${nextProjectId}:${data.initial.view}`;
        const initialCache = {
          state: initialState,
          cachedAt: Date.now(),
        };
        resourceCacheRef.current.set(initialCacheKey, initialCache);
        if (PERSISTED_RESOURCES.has(data.initial.view)) {
          scheduleResourceSessionCacheWrite(source?.getSession(), initialCacheKey, initialCache);
        }
        setResourceState(initialState);
      }
    }
    return data;
  }, [source]);

  const loadBootstrap = useCallback(async (signal) => {
    if (!source || !source.getSession()) return;
    setBootstrapState({ status: "loading", data: null, error: null });
    try {
      const envelope = await source.bootstrap({ signal, initialView: serverInitialView(view) });
      if (signal?.aborted) return;
      applyBootstrapEnvelope(envelope);
    } catch (error) {
      if (signal?.aborted) return;
      if (error.code === "unauthorized") {
        if (!source.config.loginEnabled) setLoginError(error);
        setSession(null);
      }
      setBootstrapState({ status: "error", data: null, error });
    }
  }, [source, applyBootstrapEnvelope, view]);

  useEffect(() => {
    if (!source) return undefined;
    let active = true;
    const initialize = async () => {
      const storedSession = source.getSession();
      if (!storedSession && source.config.loginEnabled) return;
      const cachedBootstrap = storedSession ? readBootstrapSessionCache(storedSession) : null;
      if (cachedBootstrap) {
        applyBootstrapEnvelope(cachedBootstrap);
        setSession(storedSession);
      }
      const requestKey = `${bootstrapRetryKey}:${storedSession ? "session" : "preview"}`;
      if (!initializationRequestRef.current || initializationRequestRef.current.key !== requestKey) {
        setLoginError(null);
        if (!cachedBootstrap) setBootstrapState({ status: "loading", data: null, error: null });
        initializationRequestRef.current = {
          key: requestKey,
          promise: storedSession
            ? source.bootstrap({ initialView: serverInitialView(view) }).catch((error) => {
              if (source.config.loginEnabled || error.code !== "unauthorized") throw error;
              source.logout();
              return Promise.all([
                source.previewBootstrap(),
                view === "overview" ? source.previewOverview().catch(() => null) : Promise.resolve(null),
              ]).then(([bootstrap, overview]) => ({ bootstrap, overview }));
            })
            : Promise.all([
              source.previewBootstrap(),
              view === "overview" ? source.previewOverview().catch(() => null) : Promise.resolve(null),
            ]).then(([bootstrap, overview]) => ({ bootstrap, overview })),
        };
      }
      const initializationRequest = initializationRequestRef.current;
      try {
        const result = await initializationRequest.promise;
        if (!active || initializationRequestRef.current !== initializationRequest) return;
        const envelope = result?.bootstrap || result;
        setSession(source.getSession());
        const bootstrapData = applyBootstrapEnvelope(envelope);
        if (result?.overview) {
          const overviewProjectId = result.overview.scope?.projectId || result.overview.data?.project?.project_id || null;
          const baseProject = bootstrapData.projects[overviewProjectId] || null;
          setOverviewState({
            status: "ready",
            data: overviewViewModel(result.overview, baseProject),
            error: null,
            resource: "overview",
            projectId: overviewProjectId,
            refreshKey: pageRefreshKey,
          });
        }
      } catch (error) {
        if (!active || initializationRequestRef.current !== initializationRequest) return;
        initializationRequestRef.current = null;
        setLoginError(error);
        setBootstrapState({ status: "error", data: null, error });
      }
    };
    initialize();
    // Keep the single initialization request alive across transient effect
    // cleanup so Apps Script never receives an identical second cold request.
    return () => { active = false; };
  }, [source, applyBootstrapEnvelope, bootstrapRetryKey]);

  useOverviewResource({ source, activeProjectId, view, bootstrapState, actorRole, overviewState, pageRefreshKey, setOverviewState, setSession });

  useEffect(() => {
    if (!source || !activeProjectId || view === "overview" || bootstrapState.status !== "ready") return undefined;
    // Authorize before consulting caches or issuing a request for a legacy URL.
    if (actorRole === "client" && !isViewAllowed(view, bootstrapState.data?.projects?.[activeProjectId]?.allowedPages || [])) return undefined;
    const cacheKey = `${resourceProjectId}:${activeResource}`;
    let cached = resourceCacheRef.current.get(cacheKey) || null;
    if (!cached && PERSISTED_RESOURCES.has(activeResource)) {
      cached = readResourceSessionCache(source.getSession(), cacheKey);
      if (cached) resourceCacheRef.current.set(cacheKey, cached);
    }
    const cachedState = cached?.state || null;
    const visibleState = resourceState.resource === activeResource && resourceState.projectId === resourceProjectId && resourceState.data
      ? resourceState
      : null;
    const cacheIsFresh = Boolean(
      cached &&
      Date.now() - cached.cachedAt < RESOURCE_CACHE_TTL_MS
    );
    if (cachedState) setResourceState(cachedState);
    if (cacheIsFresh) return undefined;
    if (!cachedState && !visibleState) setResourceState({ status: "loading", data: null, error: null, resource: activeResource, projectId: resourceProjectId, refreshKey: pageRefreshKey });
    const params = { projectId: activeProjectId, limit: 200, ...(view === "progress" ? { permissionPage: "progress" } : {}) };
    const resourceVersion = resourceVersionsRef.current.get(cacheKey) || 0;
    const requestKey = `${cacheKey}:${resourceVersion}:${pageRefreshKey}`;
    const requestEpoch = resourceCacheEpochRef.current;
    let request = resourceRequestRef.current.get(requestKey);
    if (!request) {
      const fallback = () => {
        if (view === "portfolio" || (view === "daily" && actorRole !== "client")) return source.operationsDashboard({ ...params, ...operationsDashboardRange() }).then(operationsDashboardViewModel);
        if (view === "plan") return source.plan({ ...params, planType: PLAN_VARIANTS[authorizedPlanVariant].apiValue }).then(planViewModel);
        if (view === "client-progress") return source.clientProgress(params).then(tasksViewModel);
        if (view === "tasks" || view === "schedule" || view === "progress") return source.tasks(params).then(tasksViewModel);
        if (view === "daily") return source.dailyMeetings({ ...params, limit: 100 }).then(dailyMeetingsViewModel);
        if (view === "credentials") return source.credentials(params).then(credentialsViewModel);
        if (view === "content") return source.contents(params).then(contentsViewModel);
        if (view === "tracking") return source.tracking(params).then(performanceTrackingViewModel);
        if (view === "performance") return source.performance(params).then(performanceViewModel);
        if (view === "files") return source.activity(params).then((activity) => ({ activities: activityListViewModel(activity) }));
        if (view === "permissions") return source.permissions().then(accessAdminViewModel);
        return Promise.reject(new Error(`Unsupported resource: ${view}`));
      };
      // Focused endpoints keep each tab payload bounded and avoid an expensive
      // all-tab project snapshot before the requested screen is usable.
      request = fallback();
      resourceRequestRef.current.set(requestKey, request);
      request.finally(() => {
        if (resourceRequestRef.current.get(requestKey) === request) resourceRequestRef.current.delete(requestKey);
      }).catch(() => {});
    }
    let active = true;
    request.then((data) => {
      if (resourceCacheEpochRef.current !== requestEpoch || (resourceVersionsRef.current.get(cacheKey) || 0) !== resourceVersion) return;
      const nextState = { status: "ready", data, error: null, resource: activeResource, projectId: resourceProjectId, refreshKey: pageRefreshKey };
      const nextCache = { state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      if (PERSISTED_RESOURCES.has(activeResource)) {
        scheduleResourceSessionCacheWrite(source.getSession(), cacheKey, nextCache);
      }
      if (active) setResourceState(nextState);
    }).catch((error) => {
      if (!active || resourceCacheEpochRef.current !== requestEpoch || (resourceVersionsRef.current.get(cacheKey) || 0) !== resourceVersion) return;
      if (error.code === "unauthorized") setSession(null);
      if (!cachedState && !visibleState) setResourceState({ status: "error", data: null, error, resource: activeResource, projectId: resourceProjectId, refreshKey: pageRefreshKey });
    });
    return () => { active = false; };
  }, [source, activeProjectId, resourceProjectId, view, actorRole, authorizedPlanVariant, activeResource, bootstrapState.status, bootstrapState.data, pageRefreshKey]);

  useEffect(() => {
    const nextHash = viewLocationHash(view, planVariant);
    if (window.location.hash.slice(1) !== nextHash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextHash}`);
  }, [view, planVariant]);

  const handleLogin = async (credentials) => {
    initializationRequestRef.current = null;
    setLoginError(null);
    try {
      const result = await source.login({ ...credentials, initialView: serverInitialView(view) });
      if (result.bootstrap) applyBootstrapEnvelope(result.bootstrap);
      setSession(source.getSession());
      if (!result.bootstrap) await loadBootstrap();
    } catch (error) { setLoginError(error); }
  };

  const logout = () => {
    initializationRequestRef.current = null;
    source.logout();
    clearBootstrapSessionCache();
    clearResourceSessionCache();
    activeProjectIdRef.current = null;
    setSession(null);
    setBootstrapState(blankPage);
    setOverviewState(blankPage);
    setResourceState(blankPage);
    setTaskActivityState(blankTaskActivity);
    taskActivityRequestRef.current = null;
    resourceCacheEpochRef.current += 1;
    resourceCacheRef.current.clear();
    resourceRequestRef.current.clear();
    resourceVersionsRef.current.clear();
    setCreateEntity(null);
    setSaveNotice(null);
  };

  if (configError) return <ErrorState error={configError} title="연동 설정을 확인해 주세요." />;
  if (live && !session) {
    if (!source.config.loginEnabled) {
      if (loginError) return <ErrorState error={loginError} onRetry={() => {
        setLoginError(null);
        initializationRequestRef.current = null;
        setBootstrapRetryKey((value) => value + 1);
      }} title="공개 조회 화면을 연결하지 못했습니다." />;
      return <LoadingState label="프로젝트 화면을 연결하는 중입니다." />;
    }
    return <LoginScreen onLogin={handleLogin} error={loginError} loading={sourceState.action === "login" && sourceState.phase === "loading"} configured={source.config.hasEndpoint} />;
  }
  if (bootstrapState.status === "loading" || bootstrapState.status === "idle") return <LoadingState label="접근 가능한 프로젝트를 확인하는 중입니다." />;
  if (bootstrapState.status === "error") return <ErrorState error={bootstrapState.error} onRetry={() => {
    initializationRequestRef.current = null;
    setBootstrapRetryKey((value) => value + 1);
  }} title="프로젝트 목록을 불러오지 못했습니다." />;
  if (!bootstrapState.data?.clients.length || !activeProjectId) return <EmptyState title="배정된 프로젝트가 없습니다" description="관리자가 사용자 권한과 프로젝트 배정을 확인해야 합니다." />;

  const selectedClient = bootstrapState.data.clients.find((client) => client.id === activeClient) || bootstrapState.data.clients[0];
  const baseProject = bootstrapState.data.projects[activeProjectId] || bootstrapState.data.projects[selectedClient.projectId];
  const project = overviewState.projectId === activeProjectId ? overviewState.data?.project || baseProject : baseProject;
  const actor = bootstrapState.data.actor;
  const role = actor?.role || "client";
  const cachedPageForView = view === "overview"
    ? null
    : resourceCacheRef.current.get(`${resourceProjectId}:${activeResource}`)?.state || null;
  const currentPage = view === "overview"
    ? overviewState.projectId === activeProjectId ? overviewState : { ...blankPage, status: "loading", resource: "overview", projectId: activeProjectId }
    : resourceState.resource === activeResource && resourceState.projectId === resourceProjectId
      ? resourceState
      : cachedPageForView || { ...blankPage, status: "loading", resource: activeResource, projectId: resourceProjectId };
  const notificationResource = view === "client-progress" ? "client-progress" : "tasks";
  const notificationTaskState = resourceState.resource === notificationResource && resourceState.projectId === activeProjectId
    ? resourceState
    : resourceCacheRef.current.get(`${activeProjectId}:${notificationResource}`)?.state || null;
  const notificationTasks = notificationTaskState?.data?.items || [];
  const notificationsLoaded = Boolean(notificationTaskState?.data?.items);
  const taskCount = view === "tasks" && resourceState.resource === "tasks" ? Number(resourceState.data?.total || 0) : Number(project.metrics?.[0]?.value?.replace?.(/\D/g, "") || 0);
  const canWrite = live && ["ADMIN", "EDIT"].includes(project.permissionCode);
  const canWriteTasks = canOperateProjectTasks({ live, role, loginEnabled: source.config.loginEnabled });
  const connectionReady = live && Boolean(sourceState.lastSuccessfulAt);

  const discardResourceRead = (projectId, resource) => {
    invalidateResourceReads(resourceRequestRef.current, resourceVersionsRef.current, `${projectId}:${resource}`);
  };

  const invalidateWorkspaceSummaries = () => {
    // The customer projection is a separate cache: never patch it with an
    // internal canonical task (which can contain notes or hidden tasks).
    for (const key of resourceCacheRef.current.keys()) {
      if (key.endsWith(":client-progress")) resourceCacheRef.current.delete(key);
    }
    const clientProjectIds = new Set([activeProjectId]);
    for (const key of resourceRequestRef.current.keys()) {
      if (key.includes(":client-progress:")) clientProjectIds.add(key.split(":")[0]);
    }
    for (const projectId of clientProjectIds) discardResourceRead(projectId, "client-progress");
    invalidateWorkspaceCaches({
      cache: resourceCacheRef.current,
      requests: resourceRequestRef.current,
      versions: resourceVersionsRef.current,
      removePersisted: (key) => removeResourceSessionCache(source?.getSession(), key),
    });
    if (WORKSPACE_SUMMARY_KEYS.includes(`${resourceProjectId}:${activeResource}`)) setPageRefreshKey((value) => value + 1);
  };

  const invalidateResource = (projectId, resource) => {
    const cacheKey = `${projectId}:${resource}`;
    discardResourceRead(projectId, resource);
    resourceCacheRef.current.delete(cacheKey);
    if (["tasks", "daily"].includes(resource)) invalidateWorkspaceSummaries();
    if (PERSISTED_RESOURCES.has(resource)) removeResourceSessionCache(source?.getSession(), cacheKey);
    for (const requestKey of resourceRequestRef.current.keys()) {
      if (requestKey.startsWith(`${cacheKey}:`)) resourceRequestRef.current.delete(requestKey);
    }
    if (String(projectId) === String(resourceProjectId) && resource === activeResource) setPageRefreshKey((value) => value + 1);
  };

  const refreshCurrentPage = () => {
    if (view === "overview") {
      setOverviewState((current) => current.projectId === activeProjectId
        ? { ...current, status: current.data ? "loading" : "idle", error: null }
        : current);
      setPageRefreshKey((value) => value + 1);
      return;
    }
    invalidateResource(resourceProjectId, activeResource);
  };

  const loadTaskActivity = async (options = {}) => {
    const projectId = activeProjectId;
    if (!source || !projectId) return null;
    const append = options?.append === true;
    const cursor = append ? options.cursor : null;
    if (append && !cursor) return null;
    const requestKey = `${projectId}:${append ? `${cursor.createdAt}:${cursor.id}` : "latest"}`;
    if (taskActivityRequestRef.current?.key === requestKey) return taskActivityRequestRef.current.promise;

    setTaskActivityState((current) => ({
      status: append && current.data ? current.status : "loading",
      data: current.projectId === projectId ? current.data : null,
      error: null,
      projectId,
      loadingMore: append,
    }));
    const request = source.activity({ projectId, entityType: "TASK", limit: 200, cursor })
      .then((envelope) => {
        if (activeProjectIdRef.current !== projectId) return null;
        const page = activityListViewModel(envelope);
        let resolved = page;
        setTaskActivityState((current) => {
          if (append && current.projectId === projectId && current.data) {
            const seen = new Set(current.data.items.map((item) => String(item.id)));
            const items = [...current.data.items, ...page.items.filter((item) => !seen.has(String(item.id)))];
            resolved = { ...page, items, loadedCount: items.length };
          }
          return { status: "ready", data: resolved, error: null, projectId, loadingMore: false };
        });
        return resolved;
      })
      .catch((error) => {
        if (activeProjectIdRef.current !== projectId) return null;
        if (error.code === "unauthorized") setSession(null);
        setTaskActivityState((current) => ({
          status: "error",
          data: current.projectId === projectId ? current.data : null,
          error,
          projectId,
          loadingMore: false,
        }));
        return null;
      })
      .finally(() => {
        if (taskActivityRequestRef.current?.promise === request) taskActivityRequestRef.current = null;
      });
    taskActivityRequestRef.current = { key: requestKey, promise: request };
    return request;
  };

  const createRecord = async (entityType, fields) => {
    const currentTaskState = resourceState.resource === "tasks" && resourceState.projectId === activeProjectId
      ? resourceState
      : resourceCacheRef.current.get(`${activeProjectId}:tasks`)?.state;
    const nextTaskSortOrder = Math.max(0, ...(currentTaskState?.data?.items || []).map((task) => Number(task.sortOrder) || 0)) + 10;
    const nextFields = entityType === "file"
      ? { ...fields, entity_type: "PROJECT", entity_id: activeProjectId }
      : entityType === "task"
        ? { ...fields, sort_order: nextTaskSortOrder }
        : fields;
    if (entityType === "task") discardResourceRead(activeProjectId, "tasks");
    const result = await mutateWithSaveLock("새 데이터를 원장에 기록하고 있습니다.", {
      projectId: activeProjectId,
      mutation: { entityType, operation: "CREATE", fields: nextFields },
    });
    // The canonical mutation response is the save acknowledgement. Activity
    // refresh is secondary and must not keep the create modal blocked.
    setSaveNotice(entityType === "task" ? "Supabase 업무 원장에 저장했습니다." : "Google Sheets 원장에 저장했습니다.");
    if (entityType === "task") {
      invalidateWorkspaceSummaries();
      const canonicalRecord = result?.data?.record;
      const canonicalTask = canonicalRecord
        ? tasksViewModel({ data: { items: [canonicalRecord], totalMatching: 1 }, generatedAt: result.generatedAt }).items[0]
        : null;
      if (!appendTaskResource(activeProjectId, canonicalTask)) invalidateResource(activeProjectId, "tasks");
      setTaskActivityState({ ...blankTaskActivity, projectId: activeProjectId });
    } else {
      invalidateResource(activeProjectId, activeResource);
    }
    return result;
  };

  const patchTaskResource = (projectId, taskId, updater) => {
    const patchState = (state) => {
      if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.items) return state;
      let matched = false;
      const items = state.data.items.map((item) => {
        if (item.id !== taskId) return item;
        matched = true;
        return updater(item);
      });
      return matched ? { ...state, data: { ...state.data, items } } : state;
    };

    setResourceState(patchState);
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    if (!cached?.state) return;
    const nextState = patchState(cached.state);
    if (nextState !== cached.state) {
      const nextCache = { ...cached, state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    }
  };

  const appendTaskResource = (projectId, task) => {
    if (!task?.id) return false;
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    const baseState = cached?.state || (
      resourceState.resource === "tasks" && resourceState.projectId === projectId ? resourceState : null
    );
    if (!baseState?.data?.items) return false;
    if (baseState.data.items.some((item) => item.id === task.id)) return true;
    const nextState = {
      ...baseState,
      status: "ready",
      data: {
        ...baseState.data,
        items: [...baseState.data.items, task],
        total: Number(baseState.data.total || baseState.data.items.length) + 1,
      },
    };
    const nextCache = { state: nextState, cachedAt: Date.now() };
    resourceCacheRef.current.set(cacheKey, nextCache);
    scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    if (activeProjectIdRef.current === projectId) setResourceState(nextState);
    return true;
  };

  const removeTaskResource = (projectId, taskId) => {
    const patchState = (state) => {
      if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.items) return state;
      const items = state.data.items.filter((item) => item.id !== taskId);
      if (items.length === state.data.items.length) return state;
      return {
        ...state,
        data: {
          ...state.data,
          items,
          total: Math.max(0, Number(state.data.total || state.data.items.length) - 1),
        },
      };
    };
    setResourceState(patchState);
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    if (!cached?.state) return;
    const nextState = patchState(cached.state);
    if (nextState !== cached.state) {
      const nextCache = { ...cached, state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    }
  };

  const patchIssueResource = (projectId, issueId, updater) => {
    const patchState = (state) => {
      if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.issues) return state;
      let matched = false;
      const issues = state.data.issues.map((item) => {
        if (item.id !== issueId) return item;
        matched = true;
        return updater(item);
      });
      return matched ? { ...state, data: { ...state.data, issues } } : state;
    };
    setResourceState(patchState);
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    if (!cached?.state) return;
    const nextState = patchState(cached.state);
    if (nextState !== cached.state) {
      const nextCache = { ...cached, state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    }
  };

  const appendIssueResource = (projectId, issue) => {
    if (!issue?.id) return;
    const patchState = (state) => {
      if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.issues) return state;
      if (state.data.issues.some((item) => item.id === issue.id)) return state;
      return { ...state, data: { ...state.data, issues: [issue, ...state.data.issues] } };
    };
    setResourceState(patchState);
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    if (!cached?.state) return;
    const nextState = patchState(cached.state);
    if (nextState !== cached.state) {
      const nextCache = { ...cached, state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    }
  };

  const removeIssueResource = (projectId, issueId) => {
    const patchState = (state) => {
      if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.issues) return state;
      const issues = state.data.issues.filter((item) => item.id !== issueId);
      return issues.length === state.data.issues.length ? state : { ...state, data: { ...state.data, issues } };
    };
    setResourceState(patchState);
    const cacheKey = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(cacheKey);
    if (!cached?.state) return;
    const nextState = patchState(cached.state);
    if (nextState !== cached.state) {
      const nextCache = { ...cached, state: nextState, cachedAt: Date.now() };
      resourceCacheRef.current.set(cacheKey, nextCache);
      scheduleResourceSessionCacheWrite(source?.getSession(), cacheKey, nextCache);
    }
  };

  const updateTask = async (task, fields) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 업무를 수정할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const projectId = activeProjectId;
    const previousTask = { ...task };
    // A task write must not be overwritten by a slower workspace/read request
    // that started before the click.
    discardResourceRead(projectId, "tasks");
    patchTaskResource(projectId, task.id, (current) => taskWithMutationFields(current, fields));
    try {
      const result = await mutateWithSaveLock("업무 변경사항을 원장에 기록하고 있습니다.", {
        projectId,
        mutation: {
          entityType: "task",
          operation: "UPDATE",
          id: task.id,
          expectedRowVersion: task.rowVersion,
          fields,
        },
      });
      const canonicalRecord = result?.data?.record;
      invalidateWorkspaceSummaries();
      const canonicalTask = canonicalRecord
        ? tasksViewModel({ data: { items: [canonicalRecord], totalMatching: 1 }, generatedAt: result.generatedAt }).items[0]
        : null;
      patchTaskResource(projectId, task.id, (current) => canonicalTask
        ? { ...current, ...canonicalTask }
        : { ...taskWithMutationFields(current, fields), rowVersion: Number(current.rowVersion || 0) + 1 });
      setTaskActivityState({ ...blankTaskActivity, projectId });
      setSaveNotice("업무 변경사항을 Supabase에 저장했습니다.");
      return canonicalTask;
    } catch (error) {
      patchTaskResource(projectId, task.id, () => previousTask);
      if (error.code === "conflict") invalidateResource(projectId, "tasks");
      throw error;
    }
  };

  const archiveTask = async (task) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 업무를 삭제할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const projectId = activeProjectId;
    discardResourceRead(projectId, "tasks");
    try {
      await mutateWithSaveLock("업무를 원장에서 보관 처리하고 있습니다.", {
        projectId,
        mutation: {
          entityType: "task",
          operation: "ARCHIVE",
          id: task.id,
          expectedRowVersion: task.rowVersion,
          fields: {},
        },
      });
      removeTaskResource(projectId, task.id);
      invalidateWorkspaceSummaries();
      setTaskActivityState({ ...blankTaskActivity, projectId });
      setSaveNotice("업무를 삭제했습니다. 원장에는 복구 가능한 보관 이력이 남습니다.");
    } catch (error) {
      if (error.code === "conflict") invalidateResource(projectId, "tasks");
      throw error;
    }
  };

  const updateTasksBatch = async (updates) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 업무를 수정할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    if (!Array.isArray(updates) || !updates.length || updates.length > 40) {
      const batchError = new Error("한 번에 저장할 업무 변경은 1~40건이어야 합니다.");
      batchError.code = "invalid_batch_size";
      throw batchError;
    }
    const projectId = activeProjectId;
    const previousTasks = new Map(updates.map(({ task }) => [task.id, { ...task }]));
    discardResourceRead(projectId, "tasks");
    updates.forEach(({ task, operation = "UPDATE", fields = {} }) => {
      if (operation === "ARCHIVE") removeTaskResource(projectId, task.id);
      else patchTaskResource(projectId, task.id, (current) => taskWithMutationFields(current, fields));
    });
    try {
      const result = await mutateBatchWithSaveLock(`${updates.length}개 업무 변경사항을 한 번에 기록하고 있습니다.`, {
        projectId,
        mutations: updates.map(({ task, operation = "UPDATE", fields = {} }) => ({
          entityType: "task",
          operation,
          id: task.id,
          expectedRowVersion: task.rowVersion,
          fields,
        })),
      });
      const canonicalTasks = (result?.data?.results || []).map((item) => item?.record)
        .filter(Boolean)
        .map((record) => tasksViewModel({ data: { items: [record], totalMatching: 1 }, generatedAt: result.generatedAt }).items[0]);
      invalidateWorkspaceSummaries();
      const canonicalById = new Map(canonicalTasks.map((task) => [task.id, task]));
      updates.forEach(({ task, operation = "UPDATE", fields = {} }) => {
        if (operation === "ARCHIVE") return;
        const canonicalTask = canonicalById.get(task.id);
        patchTaskResource(projectId, task.id, (current) => canonicalTask
          ? { ...current, ...canonicalTask }
          : { ...taskWithMutationFields(current, fields), rowVersion: Number(current.rowVersion || 0) + 1 });
      });
      setTaskActivityState({ ...blankTaskActivity, projectId });
      const archived = updates.filter(({ operation = "UPDATE" }) => operation === "ARCHIVE").length;
      setSaveNotice(archived === updates.length
        ? `${archived}개 업무를 삭제했습니다. 원장에는 복구 가능한 보관 이력이 남습니다.`
        : `${updates.length}개 업무 변경사항을 Supabase에 저장했습니다.`);
      return canonicalTasks;
    } catch (error) {
      updates.forEach(({ task, operation = "UPDATE" }) => {
        const previousTask = previousTasks.get(task.id);
        if (!previousTask) return;
        if (operation === "ARCHIVE") appendTaskResource(projectId, previousTask);
        else patchTaskResource(projectId, task.id, () => previousTask);
      });
      if (error.code === "conflict") invalidateResource(projectId, "tasks");
      throw error;
    }
  };

  const createProjectIssue = async (fields, projectIdOverride = null) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 이슈사항을 추가할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const projectId = projectIdOverride || activeProjectId;
    discardResourceRead(projectId, "tasks");
    const result = await mutateWithSaveLock("새 이슈 행을 원장에 기록하고 있습니다.", {
      projectId,
      mutation: { entityType: "project_issue", operation: "CREATE", fields },
    });
    const canonicalIssue = projectIssueViewModel(result?.data?.item || {});
    appendIssueResource(projectId, canonicalIssue);
    invalidateWorkspaceSummaries();
    setSaveNotice("이슈 행을 Supabase 원장에 추가했습니다.");
    return canonicalIssue;
  };

  const updateProjectIssue = async (issue, fields) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 이슈사항을 수정할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const projectId = issue.projectId || activeProjectId;
    discardResourceRead(projectId, "tasks");
    try {
      const result = await mutateWithSaveLock("이슈 변경사항을 원장에 기록하고 있습니다.", {
        projectId,
        mutation: {
          entityType: "project_issue",
          operation: "UPDATE",
          id: issue.id,
          expectedRowVersion: issue.rowVersion,
          fields,
        },
      });
      const canonicalIssue = {
        ...issue,
        ...projectIssueViewModel(result?.data?.item || {}),
        projectId,
        clientName: issue.clientName,
        projectName: issue.projectName,
      };
      patchIssueResource(projectId, issue.id, () => canonicalIssue);
      invalidateWorkspaceSummaries();
      setSaveNotice("이슈 변경사항을 Supabase에 저장했습니다.");
      return canonicalIssue;
    } catch (error) {
      if (error.code === "conflict") invalidateResource(projectId, "tasks");
      throw error;
    }
  };

  const archiveProjectIssue = async (issue) => {
    if (!canWriteTasks) {
      const readOnlyError = new Error("이 계정은 이슈사항을 삭제할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const projectId = issue.projectId || activeProjectId;
    discardResourceRead(projectId, "tasks");
    try {
      await mutateWithSaveLock("이슈 행을 원장에서 보관 처리하고 있습니다.", {
        projectId,
        mutation: {
          entityType: "project_issue",
          operation: "ARCHIVE",
          id: issue.id,
          expectedRowVersion: issue.rowVersion,
          fields: {},
        },
      });
      removeIssueResource(projectId, issue.id);
      invalidateWorkspaceSummaries();
      setSaveNotice("이슈 행을 삭제했습니다.");
    } catch (error) {
      if (error.code === "conflict") invalidateResource(projectId, "tasks");
      throw error;
    }
  };

  const updateProjectStartDate = async (projectRow, startDate) => {
    if (!canWrite || role !== "pocket") {
      const readOnlyError = new Error("이 계정은 프로젝트 착수일을 수정할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    if (!projectRow?.rowVersion) {
      const staleError = new Error("프로젝트 최신 정보를 다시 불러온 뒤 저장해 주세요.");
      staleError.code = "conflict";
      invalidateResource(activeProjectId, "tasks");
      throw staleError;
    }
    try {
      await mutateWithSaveLock("프로젝트 착수일을 원장에 기록하고 있습니다.", {
        projectId: activeProjectId,
        mutation: {
          entityType: "project",
          operation: "UPDATE",
          id: projectRow.id || activeProjectId,
          expectedRowVersion: projectRow.rowVersion,
          fields: { start_date: startDate },
        },
      });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(activeProjectId, "tasks");
      throw error;
    }
    setSaveNotice("프로젝트 착수일을 Google Sheets 원장에 저장했습니다.");
    invalidateResource(activeProjectId, "tasks");
  };

  const saveDailyMeeting = async (meeting, fields, projectIdOverride = null) => {
    if (!canWriteTasks || role === "client") {
      const readOnlyError = new Error("이 계정은 회의록을 저장할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const mutation = meeting ? {
      entityType: "daily_meeting",
      operation: "UPDATE",
      id: meeting.id,
      expectedRowVersion: meeting.rowVersion,
      fields,
    } : {
      entityType: "daily_meeting",
      operation: "CREATE",
      fields,
    };
    const meetingProjectId = projectIdOverride || activeProjectId;
    const dailyResourceProjectId = view === "daily" && role !== "client" ? "workspace" : meetingProjectId;
    try {
      await mutateWithSaveLock("회의록을 원장에 기록하고 있습니다.", { projectId: meetingProjectId, mutation });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(dailyResourceProjectId, "daily");
      throw error;
    }
    setSaveNotice(meeting ? "회의록을 수정했습니다." : "회의록을 저장했습니다.");
    invalidateResource(dailyResourceProjectId, "daily");
  };

  const saveProjectCredential = async (credential, fields) => {
    if (!canWriteTasks || role === "client") {
      const forbidden = new Error("이 계정은 아이디 관리대장을 수정할 권한이 없습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    const mutation = credential ? {
      entityType: "project_credential",
      operation: "UPDATE",
      id: credential.id,
      expectedRowVersion: credential.rowVersion,
      fields,
    } : {
      entityType: "project_credential",
      operation: "CREATE",
      fields,
    };
    try {
      await mutateWithSaveLock("계정 정보를 암호화해 저장하고 있습니다.", { projectId: activeProjectId, mutation });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(activeProjectId, "credentials");
      throw error;
    }
    setSaveNotice(credential ? "계정 정보를 수정했습니다." : "사이트 계정을 등록했습니다.");
    invalidateResource(activeProjectId, "credentials");
  };

  const archiveProjectCredential = async (credential) => {
    if (!canWriteTasks || role === "client") {
      const forbidden = new Error("이 계정은 아이디 관리대장을 삭제할 권한이 없습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    try {
      await mutateWithSaveLock("계정 정보와 암호화된 비밀번호를 삭제하고 있습니다.", {
        projectId: activeProjectId,
        mutation: {
          entityType: "project_credential",
          operation: "ARCHIVE",
          id: credential.id,
          expectedRowVersion: credential.rowVersion,
          fields: {},
        },
      });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(activeProjectId, "credentials");
      throw error;
    }
    setSaveNotice("계정 정보와 저장된 비밀번호를 삭제했습니다.");
    invalidateResource(activeProjectId, "credentials");
  };

  const revealProjectCredential = async (credential) => {
    if (role === "client") {
      const forbidden = new Error("내부 운영 계정만 비밀번호를 열람할 수 있습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    const result = await source.revealCredential({ projectId: activeProjectId, credentialId: credential.id });
    return String(result?.data?.password ?? "");
  };

  const saveKpiDefinition = async (kpi, fields) => {
    if (!canWrite || role === "client") {
      const readOnlyError = new Error("이 계정은 KPI를 설정할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    const mutation = kpi ? {
      entityType: "kpi_definition",
      operation: "UPDATE",
      id: kpi.id,
      expectedRowVersion: kpi.rowVersion,
      fields,
    } : {
      entityType: "kpi_definition",
      operation: "CREATE",
      fields,
    };
    try {
      await mutateWithSaveLock("KPI 설정을 원장에 기록하고 있습니다.", { projectId: activeProjectId, mutation });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(activeProjectId, "performance");
      throw error;
    }
    setSaveNotice(kpi ? "KPI 목표를 Supabase 원장에 수정했습니다." : "새 KPI를 Supabase 원장에 추가했습니다.");
    invalidateResource(activeProjectId, "performance");
  };

  const archiveKpiDefinition = async (kpi) => {
    if (!canWrite || role === "client") {
      const readOnlyError = new Error("이 계정은 KPI를 보관할 권한이 없습니다.");
      readOnlyError.code = "forbidden";
      throw readOnlyError;
    }
    try {
      await mutateWithSaveLock("KPI 보관 상태를 원장에 기록하고 있습니다.", {
        projectId: activeProjectId,
        mutation: {
          entityType: "kpi_definition",
          operation: "ARCHIVE",
          id: kpi.id,
          expectedRowVersion: kpi.rowVersion,
          fields: {},
        },
      });
    } catch (error) {
      if (error.code === "conflict") invalidateResource(activeProjectId, "performance");
      throw error;
    }
    setSaveNotice("KPI를 보관했습니다.");
    invalidateResource(activeProjectId, "performance");
  };

  const saveAccessAccount = async (account) => {
    if (!canManageClientAccess(role)) {
      const forbidden = new Error("내부 운영 계정만 고객 권한을 관리할 수 있습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    await accessMutateWithSaveLock("계정과 페이지 권한을 Supabase에 기록하고 있습니다.", { operation: account.operation, account });
    setSaveNotice(account.operation === "DISABLE" ? "고객사 계정을 비활성화했습니다." : account.operation === "REMOVE_ACCESS" ? "선택한 프로젝트 권한을 제거했습니다." : "고객사 계정과 페이지 권한을 저장했습니다.");
    invalidateResource(activeProjectId, "permissions");
  };

  const createProject = async (input) => {
    if (!["pocket", "ns"].includes(role) || typeof source.createProject !== "function") {
      const forbidden = new Error("이 계정은 프로젝트를 생성할 권한이 없습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    const payload = input?.fields ? input : { fields: input };
    const result = await runSheetWrite(payload.tasks?.length ? `견적 업무 ${payload.tasks.length}개와 새 프로젝트를 저장하고 있습니다.` : "새 프로젝트와 편집 권한을 생성하고 있습니다.", () => source.createProject(payload));
    const createdClientId = result?.data?.client?.client_id;
    const createdProjectId = result?.data?.project?.project_id;
    if (!createdClientId || !createdProjectId) {
      const contractError = new Error("프로젝트는 생성됐지만 새 프로젝트 식별자를 받지 못했습니다. 목록을 다시 불러와 주세요.");
      contractError.code = "invalid_contract";
      throw contractError;
    }

    clearBootstrapSessionCache();
    activeProjectIdRef.current = createdProjectId;
    let envelope;
    try {
      envelope = await source.bootstrap({ initialView: "tasks" });
    } catch {
      initializationRequestRef.current = null;
      setBootstrapRetryKey((current) => current + 1);
      setSaveNotice("프로젝트 생성은 완료됐습니다. 새 목록을 다시 불러오는 중입니다.");
      return result;
    }
    const nextBootstrap = applyBootstrapEnvelope(envelope);
    if (!nextBootstrap.projects[createdProjectId] || !nextBootstrap.clients.some((client) => client.id === createdClientId)) {
      initializationRequestRef.current = null;
      setBootstrapRetryKey((current) => current + 1);
      setSaveNotice("프로젝트 생성은 완료됐습니다. 새 목록 권한을 다시 확인하고 있습니다.");
      return result;
    }
    setActiveClient(createdClientId);
    setActiveProjectId(createdProjectId);
    activeProjectIdRef.current = createdProjectId;
    setView("schedule");
    setSearch("");
    setSaveNotice(payload.tasks?.length ? `견적서에서 프로젝트와 업무 ${payload.tasks.length}개를 생성했습니다.` : "새 프로젝트를 생성하고 편집 권한을 연결했습니다.");
    return result;
  };

  const appendQuoteToProject = async (payload) => {
    if (!["pocket", "ns"].includes(role) || typeof source.importQuoteTasks !== "function") {
      const forbidden = new Error("이 계정은 견적 업무를 추가할 권한이 없습니다.");
      forbidden.code = "forbidden";
      throw forbidden;
    }
    const result = await runSheetWrite(`견적 업무 ${payload.tasks.length}개를 한 번에 저장하고 있습니다.`, () => source.importQuoteTasks({ projectId: activeProjectId, quote: payload.quote, tasks: payload.tasks }));
    setBootstrapState((current) => current.status !== "ready" ? current : ({
      ...current,
      data: {
        ...current.data,
        projects: {
          ...current.data.projects,
          [activeProjectId]: { ...current.data.projects[activeProjectId], quoteData: payload.quote },
        },
      },
    }));
    invalidateResource(activeProjectId, "tasks");
    setView("schedule");
    setSearch("");
    setSaveNotice(`현재 프로젝트에 견적 업무 ${payload.tasks.length}개를 추가했습니다.`);
    return result;
  };

  const selectClient = (clientId) => {
    const client = bootstrapState.data.clients.find((item) => item.id === clientId);
    if (!client) return;
    setActiveClient(clientId);
    setActiveProjectId(client.projectId);
    activeProjectIdRef.current = client.projectId;
    setOverviewState(blankPage);
    setResourceState(blankPage);
    setTaskActivityState({ ...blankTaskActivity, projectId: client.projectId });
    taskActivityRequestRef.current = null;
    const nextProject = bootstrapState.data.projects[client.projectId];
    const nextView = role !== "client" || isViewAllowed("schedule", nextProject?.allowedPages || []) ? "schedule" : firstAllowedView(nextProject?.allowedPages || []);
    setView(["progress", "client-progress"].includes(view) && (role !== "client" || isViewAllowed(view, nextProject?.allowedPages || [])) ? view : nextView);
    setSearch("");
  };

  const openDashboardProject = (projectId, targetView = "schedule") => {
    const client = bootstrapState.data.clients.find((item) => String(item.projectId) === String(projectId));
    if (!client) return;
    setActiveClient(client.id);
    setActiveProjectId(client.projectId);
    activeProjectIdRef.current = client.projectId;
    setOverviewState(blankPage);
    setResourceState(blankPage);
    setTaskActivityState({ ...blankTaskActivity, projectId: client.projectId });
    taskActivityRequestRef.current = null;
    setView(targetView);
    setSearch("");
  };

  const navigateToView = (nextView, nextPlanVariant = planVariant) => {
    if (role === "client" && !isViewAllowed(nextView, project.allowedPages)) return;
    if (nextView === "permissions" && !canManageClientAccess(role)) return;
    if (nextView === "plan") setPlanVariant(nextPlanVariant);
    setView(nextView);
  };

  const toggleNavigation = () => {
    if (navigation.usesDrawer) setSidebarOpen((current) => !current);
    else setDesktopSidebarCollapsed((current) => !current);
  };

  const openNotificationTask = (task) => {
    navigateToView("schedule");
    setSearch(task?.title || "");
  };

  return (
    <div className={`app-shell has-sidebar-workspace ${navigation.projectSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${navigation.isDrawerOpen ? "is-navigation-drawer-open" : ""} ${role === "client" ? "is-client-view" : ""} ${sheetSaveLock.visible ? "is-sheet-saving" : ""}`} aria-busy={sheetSaveLock.visible}>
      <ProjectSidebar project={project} clients={bootstrapState.data.clients} activeClient={selectedClient.id} onSelectClient={selectClient} onCreateProject={() => setProjectCreateOpen(true)} onImportQuote={() => setQuoteImportOpen(true)} canCreateProject={live && ["pocket", "ns"].includes(role) && typeof source.createProject === "function"} navigation={navigation} onToggleNavigation={toggleNavigation} role={role} activeView={view} activePlanVariant={authorizedPlanVariant} onView={navigateToView} open={navigation.isDrawerOpen} onClose={() => setSidebarOpen(false)} taskCount={taskCount} visible={navigation.projectSidebarVisible} />
      {navigation.isDrawerOpen && <button className="mobile-overlay" type="button" onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기" />}
      <div className="app-main"><Topbar project={project} activeView={view} actor={actor} onLogout={logout} live={live && source.config.loginEnabled} search={search} setSearch={setSearch} notificationTasks={notificationTasks} notificationsLoaded={notificationsLoaded} onNotificationSelect={openNotificationTask} /><main className="content-canvas"><AppContent source={source} actorName={actor?.displayName || actor?.name || (role === "ns" ? "NS" : "포켓컴퍼니")} view={view} planVariant={authorizedPlanVariant} project={project} role={role} search={search} setView={navigateToView} pageState={currentPage} taskActivityState={taskActivityState} onLoadTaskActivity={loadTaskActivity} onRetry={refreshCurrentPage} onCreate={setCreateEntity} onTaskUpdate={updateTask} onTaskArchive={archiveTask} onTaskBatchUpdate={updateTasksBatch} onProjectUpdate={updateProjectStartDate} onIssueCreate={createProjectIssue} onIssueUpdate={updateProjectIssue} onIssueArchive={archiveProjectIssue} onDailyMeetingSave={saveDailyMeeting} onCredentialSave={saveProjectCredential} onCredentialArchive={archiveProjectCredential} onCredentialReveal={revealProjectCredential} onKpiSave={saveKpiDefinition} onKpiArchive={archiveKpiDefinition} onAccessSave={saveAccessAccount} onOpenProject={openDashboardProject} canWrite={(view === "tasks" || view === "schedule" || view === "progress" || view === "daily" || view === "credentials" || view === "portfolio") ? canWriteTasks : canWrite} /></main><footer className="app-footer"><span>{connectionReady ? "데이터 연결됨" : "연결 확인 중"}</span><span>마지막 동기화 {formatSyncTime(sourceState.lastSuccessfulAt)}</span></footer></div>
      {createEntity && <CreateRecordModal entityType={createEntity} role={role} clientName={project.clientName} onClose={() => setCreateEntity(null)} onSubmit={createRecord} />}
      {projectCreateOpen && <ProjectCreateModal onClose={() => setProjectCreateOpen(false)} onSubmit={createProject} />}
      {quoteImportOpen && <Suspense fallback={<LoadingState label="견적서 화면을 여는 중입니다." />}><QuoteImportModal currentProject={project} onClose={() => setQuoteImportOpen(false)} onCreateProject={createProject} onAppendProject={appendQuoteToProject} /></Suspense>}
      {saveNotice && <div className="save-toast" role="status"><Check size={16} />{saveNotice}</div>}
      {sheetSaveLock.visible && <GlobalSaveOverlay label={sheetSaveLock.label} />}
    </div>
  );
}
