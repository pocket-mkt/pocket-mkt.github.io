import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CompanyBrand from "./CompanyBrand.jsx";
import CompanySymbol from "./CompanySymbol.jsx";
import { statusClass, formatSyncTime, EmptyState, LoadingState, ErrorState, FormSelect, trackerStatusOptions, trackerStatusLabels, trackerDate, localDateValue } from "./TaskUiPrimitives.jsx";
const TaskScheduleTimeline = lazy(() => import("./TaskWorkspace.jsx").then(module => ({ default: module.TaskScheduleTimeline })));
import { Activity, AlertCircle, ArrowRight, BarChart3, Bell, BookOpenText, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCheck, FolderOpen, FileUp, LayoutDashboard, KeyRound, ListFilter, LoaderCircle, LockKeyhole, LogOut, MoreHorizontal, MousePointerClick, NotebookPen, Pencil, Plus, Search, Settings2, ShieldCheck, TrendingUp, Trash2, Video, WifiOff, X } from "lucide-react";
import { activityListViewModel, bootstrapViewModel, createHubDataSource, overviewViewModel, operationsDashboardViewModel, projectIssueViewModel, taskResponsibleOrganization, tasksViewModel } from "./api/index.js";
import { getNavigationPresentation } from "./navigationState.js";
import {
  DEFAULT_PLAN_VARIANT,
  PLAN_VARIANTS,
  parseViewLocation,
  viewLocationHash,
  viewResourceKey,
} from "./planNavigation.js";
import { canOperateProjectTasks, taskResponsibleOrgLabel, taskResponsibleOrgOptions } from "./taskForm.js";
import { acquireBodyScrollLock } from "./bodyScrollLock.js";
import { disclosureChevronDirection, disclosureChevronGlyph } from "./taskGroupState.js";
import { withDisplayDeadline } from "./taskTimeline.js";
import { normalizeScheduleDates } from "./taskGantt.js";
import { isNewTask, unacknowledgedNewTasks } from "./taskFreshness.js";
import { effectiveTaskScheduleState } from "./taskScheduleStatus.js";
import { KPI_CHANNEL_OPTIONS, KPI_PERIOD_OPTIONS, KPI_UNIT_OPTIONS, kpiInitialFields, kpiSubmissionFields } from "./kpiForm.js";
import { NAVIGATION_PAGE_OPTIONS, PROJECT_NAVIGATION_GROUP, firstAllowedView, isViewAllowed } from "./accessPermissions.js";
import { dailyMetricSeries, trackingFunnel, trackingSignals, TRACKING_METRICS } from "./performanceTracking.js";
import { clearResourceSessionCache, removeResourceSessionCache, scheduleResourceSessionCacheWrite } from "./resourceSessionCache.js";
import { useOverviewResource } from "./useOverviewResource.js";
import { invalidateResourceReads, invalidateWorkspaceCaches, WORKSPACE_SUMMARY_KEYS } from "./resourceInvalidation.js";
import { startWorkspaceRefresh, authorizationFingerprint } from "./workspaceRefresh.js";
import { applyTaskChanges, restoreTaskChanges } from "./taskResourcePatch.js";
import { useActiveResource } from "./useActiveResource.js";
import { PERSISTED_RESOURCES } from "./resourcePolicy.js";

const SAVE_OVERLAY_MIN_MS = 500;
const SAVE_OVERLAY_COALESCE_MS = 250;
const CredentialLedgerView = lazy(() => import("./CredentialLedgerView.jsx").then((module) => ({ default: module.CredentialLedgerView })));
const OperationsDashboardView = lazy(() => import("./OperationsDashboardView.jsx").then((module) => ({ default: module.OperationsDashboardView })));
const WorkspaceDailyMeetingsView = lazy(() => import("./OperationsDashboardView.jsx").then((module) => ({ default: module.WorkspaceDailyMeetingsView })));
const ProgressView = lazy(() => import("./ProgressView.jsx").then((module) => ({ default: module.ProgressView })));
const ClientProgressView = lazy(() => import("./ClientProgressView.jsx").then((module) => ({ default: module.ClientProgressView })));
const TaskCreateModal = lazy(() => import("./TaskCreateModal.jsx").then((module) => ({ default: module.TaskCreateModal })));
const QuoteImportModal = lazy(() => import("./QuoteImportModal.jsx"));
const PermissionsView = lazy(() => import("./PermissionsView.jsx"));

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


function ProgressBar({ value, color = "var(--accent)" }) {
  if (value === null || value === undefined) return null;
  return <div className="progress-track" aria-label={`${value}% 진행`}><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(value, 100))}%`, background: color }} /></div>;
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
      <div className="sidebar-menu-header">{visible && <div className="sidebar-menu-brand"><CompanySymbol /><strong>프로젝트 · 메뉴</strong></div>}<button className="sidebar-toggle" type="button" onClick={onToggleNavigation} aria-label={navigation.actionLabel} title={navigation.actionLabel} aria-expanded={visible} aria-controls={navigation.controlledIds}>{visible ? <ChevronLeft size={20} strokeWidth={2.5} /> : <ChevronRight size={20} strokeWidth={2.5} />}</button></div>
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
return <header className="topbar"><div className="topbar-leading"><CompanyBrand /><div className={`topbar-project-context${workspaceMode ? " is-workspace" : ""}`}><small>{workspaceMode ? "전체 프로젝트" : project.clientName}</small><strong title={workspaceMode ? "통합 관리" : project.name}>{workspaceMode ? "통합 관리" : project.name}</strong></div></div><div className="topbar-actions">{!workspaceMode && <><label className="global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="업무 검색" /></label><TaskNotificationCenter projectId={project.id} tasks={notificationTasks} loaded={notificationsLoaded} onSelect={onNotificationSelect} /></>}<ActorBadge actor={actor} onLogout={onLogout} live={live} /></div></header>;
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

  return <Suspense fallback={<LoadingState label="업무 화면을 준비하고 있습니다." />}><div className="view-stack campaign-schedule-root"><TaskScheduleTimeline tasks={tasks} issues={taskPage.issues || []} project={taskPage.project || {}} query={query} canWrite={editable} canWriteIssues={Boolean(editable && taskPage.issueCanWrite)} actorName={actorName} canEditProject={Boolean(editable && role === "pocket")} canManageVisibility={Boolean(editable && role === "pocket")} onUpdate={onUpdate} onArchive={onArchive} onBatchUpdate={onBatchUpdate} onProjectUpdate={onProjectUpdate} onCreate={onCreate} onIssueCreate={onIssueCreate} onIssueUpdate={onIssueUpdate} onIssueArchive={onIssueArchive} displayMode={displayMode} onViewChange={selectTaskView} canViewActivity={role !== "client"} activityState={activityState} onLoadActivity={onLoadActivity} /></div></Suspense>;
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
  if (view === "permissions") return canManageClientAccess(role) ? <Suspense fallback={<LoadingState label="권한관리 화면을 준비하고 있습니다." />}><PermissionsView access={data} onSave={onAccessSave} role={role} /></Suspense> : <ErrorState error={new Error("내부 운영 계정만 접근할 수 있습니다.")} />;
  if (view === "files") return <DetailLogView role={role} activities={data.activities?.items || []} />;
  return <OverviewView project={data.project || project} role={role} activities={data.activities || []} onNavigate={setView} />;
}

const blankPage = { status: "idle", data: null, error: null, resource: null, projectId: null };
const blankTaskActivity = { status: "idle", data: null, error: null, projectId: null, loadingMore: false };
const BOOTSTRAP_SESSION_CACHE_KEY = "pocket-marketing-hub.bootstrap.v2";

function serverInitialView(view) {
  return view === "schedule" ? "tasks" : view;
}

function clearBootstrapSessionCache() {
  try { globalThis.sessionStorage?.removeItem(BOOTSTRAP_SESSION_CACHE_KEY); } catch {}
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
      clearResourceSessionCache();
      clearBootstrapSessionCache();
      resourceCacheEpochRef.current++;
      resourceCacheRef.current.clear();
      resourceRequestRef.current.clear();
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
    // A persisted snapshot is not evidence of current permission or visibility.
    // Cancel pending writes too: an old idle callback must not resurrect it.
    clearResourceSessionCache();
    clearBootstrapSessionCache();
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
      // Do not render prior privileged data until the server revalidates access.
      const cachedBootstrap = null;
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
    if (!source || !session || bootstrapState.status !== "ready") return undefined;
    let active = true;
    const controller = new AbortController();
    const editing = () => sheetWriteCountRef.current > 0 || Boolean(document.querySelector('[role="dialog"], .is-dragging, .is-painting')) || Boolean(document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'));
    const stop = startWorkspaceRefresh({
      busy: editing,
      refresh: async () => {
        const requestEpoch = resourceCacheEpochRef.current;
        const versions = JSON.stringify([...resourceVersionsRef.current]);
        let envelope;
        try {
          envelope = await source.bootstrap({ signal: controller.signal });
        } catch (error) {
          if (active && ["forbidden", "unauthorized"].includes(error.code)) {
            clearResourceSessionCache();
            clearBootstrapSessionCache();
            resourceCacheEpochRef.current++;
            resourceCacheRef.current.clear();
            resourceRequestRef.current.clear();
            setResourceState(blankPage);
            setBootstrapState({ status: "error", data: null, error });
          }
          throw error;
        }
        if (!active || requestEpoch !== resourceCacheEpochRef.current || sheetWriteCountRef.current > 0) return;
        const next = bootstrapViewModel(envelope);
        if (authorizationFingerprint(next) !== authorizationFingerprint(bootstrapState.data)) {
          applyBootstrapEnvelope(envelope);
          return;
        }
        if (editing() || versions !== JSON.stringify([...resourceVersionsRef.current])) return;
        // Drop cached projections even if grants match: task visibility itself
        // may have changed. Re-read only the currently displayed resource.
        clearResourceSessionCache();
        resourceCacheEpochRef.current++;
        resourceCacheRef.current.clear();
        resourceRequestRef.current.clear();
        setTaskActivityState(blankTaskActivity);
        setPageRefreshKey(value => value + 1);
      },
    });
    return () => { active = false; controller.abort(); stop(); };
  }, [source, session, bootstrapState.status, bootstrapState.data, applyBootstrapEnvelope]);

  useEffect(() => {
    if (!source || !["pocket", "ns"].includes(actorRole) || !session) return undefined;
    const inspect = () => source.getDiagnostics();
    window.pocketHubDiagnostics = inspect;
    return () => { if (window.pocketHubDiagnostics === inspect) delete window.pocketHubDiagnostics; };
  }, [source, actorRole, session]);

  useActiveResource({ source, activeProjectId, resourceProjectId, view, actorRole, authorizedPlanVariant, activeResource, bootstrapState, pageRefreshKey, resourceState, resourceCacheRef, resourceRequestRef, resourceCacheEpochRef, resourceVersionsRef, setResourceState, setSession, operationsDashboardRange });

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

  const patchTaskBatchResource = (projectId, transform) => {
    setResourceState(transform);
    const key = `${projectId}:tasks`;
    const cached = resourceCacheRef.current.get(key);
    if (!cached?.state) return;
    const state = transform(cached.state);
    if (state === cached.state) return;
    const next = { ...cached, state, cachedAt: Date.now() };
    resourceCacheRef.current.set(key, next);
    scheduleResourceSessionCacheWrite(source?.getSession(), key, next);
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
    const originalItems = resourceCacheRef.current.get(`${projectId}:tasks`)?.state?.data?.items || resourceState.data?.items || [];
    discardResourceRead(projectId, "tasks");
    const optimistic = new Map(updates.map(({ task, operation = "UPDATE", fields = {} }) => [task.id, current => operation === "ARCHIVE" ? null : taskWithMutationFields(current, fields)]));
    patchTaskBatchResource(projectId, state => applyTaskChanges(state, projectId, optimistic));
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
      const canonicalChanges = new Map(updates.filter(({ operation }) => operation !== "ARCHIVE").map(({ task, fields = {} }) => {
        const canonicalTask = canonicalById.get(task.id);
        return [task.id, (current) => canonicalTask
          ? { ...current, ...canonicalTask }
          : { ...taskWithMutationFields(current, fields), rowVersion: Number(current.rowVersion || 0) + 1 }];
      }));
      patchTaskBatchResource(projectId, state => applyTaskChanges(state, projectId, canonicalChanges));
      setTaskActivityState({ ...blankTaskActivity, projectId });
      const archived = updates.filter(({ operation = "UPDATE" }) => operation === "ARCHIVE").length;
      setSaveNotice(archived === updates.length
        ? `${archived}개 업무를 삭제했습니다. 원장에는 복구 가능한 보관 이력이 남습니다.`
        : `${updates.length}개 업무 변경사항을 Supabase에 저장했습니다.`);
      return canonicalTasks;
    } catch (error) {
      patchTaskBatchResource(projectId, state => restoreTaskChanges(state, projectId, originalItems, new Set(updates.map(({ task }) => task.id))));
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
export { TaskScheduleTimeline };
