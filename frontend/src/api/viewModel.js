import { normalizeScheduleDates } from "../taskGantt.js";
import { effectiveTaskScheduleState } from "../taskScheduleStatus.js";
import { WORKSTREAM_LABELS } from "../taskWorkstreams.js";

const PHASE_LABELS = {
  P0: "구축",
  M1: "운영 1개월차",
  M2: "운영 2개월차",
  M3: "운영 3개월차",
};

const STATUS_LABELS = {
  PREPARING: "준비",
  ACTIVE: "진행 중",
  PAUSED: "중지",
  COMPLETED: "완료",
  TODO: "미착수",
  NOT_STARTED: "미착수",
  IN_PROGRESS: "진행",
  INTERNAL_REVIEW: "검토",
  WAITING_CLIENT: "고객 확인",
  REVISION: "검토",
  DONE: "완료",
  BLOCKED: "차단",
  ON_HOLD: "보류",
  DRAFT: "초안",
  PLANNED: "예정",
  IDEA: "기획",
  PRODUCTION: "제작",
  READY: "게시예약",
  PUBLISHED: "완료",
};

const CHANNEL_LABELS = {
  WEBSITE: "자사몰",
  YOUTUBE: "유튜브",
  INSTAGRAM: "인스타그램",
  NAVER_BLOG: "네이버 블로그",
  NAVER_SMARTSTORE: "스마트스토어",
  NAVER_SMARTPLACE: "스마트플레이스",
  NAVER_ADS: "네이버 광고",
  META_ADS: "메타 광고",
  GOOGLE_SEARCH: "구글 검색",
  GEO: "AI 검색",
};

const FORMAT_LABELS = {
  LONG_FORM: "롱폼",
  SHORT_FORM: "숏폼",
  FEED: "피드",
  REELS: "릴스",
  ARTICLE: "아티클",
};

const PRIORITY_LABELS = { LOW: "낮음", NORMAL: "보통", HIGH: "높음", CRITICAL: "긴급", URGENT: "긴급" };
const TASK_RESPONSIBLE_ORG_LABELS = { POCKET: "포켓", NS: "NS", CLIENT: "고객사" };
const ACTIVITY_ACTION_LABELS = { CREATED: "추가", UPDATED: "수정", ARCHIVED: "보관", APPROVED: "승인", REJECTED: "반려" };
const ACTIVITY_FIELD_LABELS = {
  title: "업무명",
  status_code: "상태",
  description: "세부내용",
  planned_start_date: "시작일",
  due_date: "종료일",
  schedule_dates_json: "간트 일정",
  progress_percent: "진행률",
  completion_url: "완료링크",
  remarks: "비고",
  priority_code: "우선순위",
  responsible_org_code: "담당",
  workstream_code: "업무 분야",
  phase_code: "단계",
  visibility_code: "고객 공개 범위",
};
// 화면의 대외 담당 주체는 포켓컴퍼니로 통일한다.
// 원장에 남아 있는 기존 NS 코드도 표시 단계에서는 포켓컴퍼니로 정규화한다.
const ORG_LABELS = { POCKET: "포켓컴퍼니", NS: "포켓컴퍼니", NS_MARKETING: "포켓컴퍼니", CLIENT: "고객사" };
const UNIT_LABELS = { COUNT: "건", PEOPLE: "명", KRW: "원", PERCENT: "%", RATE: "%", VIEW: "회" };

function ownerLabel(orgCode, assignee) {
  const mappedOrg = ORG_LABELS[String(orgCode || "").trim().toUpperCase()];
  if (mappedOrg) return mappedOrg;

  const rawAssignee = String(assignee || "").trim();
  const normalizedAssignee = rawAssignee.toUpperCase().replace(/[\s_-]/g, "");
  if (["NS", "NS마케팅", "NSMARKETING"].includes(normalizedAssignee)) return "포켓컴퍼니";
  return rawAssignee || "미지정";
}

export function taskResponsibleOrganization(value) {
  const rawCode = String(value || "").trim().toUpperCase();
  const code = rawCode === "NS_MARKETING" ? "NS" : rawCode;
  const normalizedCode = Object.prototype.hasOwnProperty.call(TASK_RESPONSIBLE_ORG_LABELS, code) ? code : "POCKET";
  return { code: normalizedCode, label: TASK_RESPONSIBLE_ORG_LABELS[normalizedCode] };
}

function activityChangeValue(field, value) {
  if (value === null || value === undefined || value === "") return value ?? "";
  if (field === "schedule_dates_json") {
    const dates = normalizeScheduleDates(value);
    if (!dates?.length) return "일정 없음";
    const periodLabel = dates.length > 1 ? ` · ${dates[0]}~${dates[dates.length - 1]}` : ` · ${dates[0]}`;
    return `${dates.length}일${periodLabel}`;
  }
  const normalized = String(value).trim().toUpperCase();
  if (field === "status_code") return STATUS_LABELS[normalized] || value;
  if (field === "responsible_org_code") {
    const organizationCode = normalized === "NS_MARKETING" ? "NS" : normalized;
    return TASK_RESPONSIBLE_ORG_LABELS[organizationCode] || value;
  }
  if (field === "visibility_code") return { CLIENT: "고객 공개", PROJECT_TEAM: "고객 숨김", POCKET_ONLY: "포켓 전용" }[normalized] || value;
  return value;
}

function codeLabel(code, labels, fallback = "미지정") {
  const normalized = String(code || "").toUpperCase();
  return labels[normalized] || (normalized ? normalized.replaceAll("_", " ") : fallback);
}

function dateOnly(value) {
  if (!value) return "미정";
  const day = String(value).slice(0, 10);
  const match = day.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}` : day;
}

function period(start, end) {
  if (!start && !end) return "일정 미정";
  return `${start ? String(start).slice(0, 10).replaceAll("-", ".") : "미정"} — ${end ? String(end).slice(0, 10).replaceAll("-", ".") : "미정"}`;
}

function relativeTimestamp(value) {
  if (!value) return "업데이트 기록 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function numberFrom(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publishingValues(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const read = (...keys) => {
    const key = keys.find((candidate) => source[candidate] !== undefined && source[candidate] !== null && source[candidate] !== "");
    return key ? numberFrom(source[key]) : 0;
  };
  const longForm = read("long_form", "longForm", "LONG_FORM", "lf");
  const shortForm = read("short_form", "shortForm", "SHORT_FORM", "sf");
  const instagram = read("instagram", "INSTAGRAM", "feed", "FEED", "ig");
  const blog = read("blog", "BLOG", "naver_blog", "NAVER_BLOG", "article", "ARTICLE", "bl");
  const calculatedTotal = longForm + shortForm + instagram + blog;
  return {
    longForm,
    shortForm,
    instagram,
    blog,
    total: read("total", "TOTAL") || calculatedTotal,
  };
}

function publishingViewModel(value) {
  const source = value && typeof value === "object" ? value : {};
  const rows = Array.isArray(value)
    ? value
    : source.phases || source.byPhase || source.items || [];
  return {
    phases: rows.map((row) => ({
      phaseCode: String(row.phase_code || row.phaseCode || row.code || "").toUpperCase(),
      phase: codeLabel(row.phase_code || row.phaseCode || row.code, PHASE_LABELS),
      target: publishingValues(row.target || row.targets || row.target_count || {}),
      actual: publishingValues(row.actual || row.actuals || row.published || {}),
    })).filter((row) => row.phaseCode),
    updatedAt: source.updated_at || source.updatedAt || null,
  };
}

export function actorRole(roleCode) {
  if (String(roleCode).toUpperCase() === "CLIENT_VIEWER") return "client";
  if (String(roleCode).toUpperCase() === "EXECUTOR_EDITOR") return "ns";
  return "pocket";
}

function projectShell(row, clientsById = {}, generatedAt = null) {
  return {
    id: row.project_id,
    clientId: row.client_id,
    clientName: clientsById[row.client_id]?.name || row.client_id || "고객사",
    name: row.project_name || "프로젝트",
    label: codeLabel(row.service_type_code, { CONTENT_MARKETING: "콘텐츠 마케팅" }, "마케팅 프로젝트"),
    phaseCode: String(row.phase_code || "").toUpperCase(),
    phase: codeLabel(row.phase_code, PHASE_LABELS),
    status: codeLabel(row.status_code, STATUS_LABELS),
    permissionCode: String(row.permission_code || "READ_ONLY").toUpperCase(),
    allowedPages: Array.isArray(row.allowed_pages) ? row.allowed_pages.map((page) => String(page).toLowerCase()) : ["overview", "plan", "tasks", "progress", "daily", "performance", "files"],
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    rowVersion: Number(row.row_version || 0),
    quoteData: row.quote_data && typeof row.quote_data === "object" ? row.quote_data : null,
    period: period(row.start_date, row.end_date),
    updatedAt: relativeTimestamp(generatedAt),
    objective: row.objective || "등록된 프로젝트 목표가 없습니다.",
    metrics: [],
    phases: [],
    workstreams: [],
    attention: [],
  };
}

export function accessAdminViewModel(envelope) {
  const data = envelope?.data || {};
  const projects = (data.projects || []).map((row) => ({
    id: row.project_id,
    clientId: row.client_id,
    name: row.project_name || row.project_id,
  }));
  const projectById = Object.fromEntries(projects.map((project) => [project.id, project]));
  return {
    clients: (data.clients || []).map((row) => ({ id: row.client_id, name: row.display_name || row.client_id })),
    projects,
    accounts: (data.accounts || []).map((row) => ({
      id: row.user_id,
      account: row.account || String(row.email || "").replace(/@hub\.local$/i, ""),
      displayName: row.display_name || row.user_id,
      enabled: String(row.status_code || "").toUpperCase() === "ACTIVE",
      rowVersion: Number(row.row_version || 0),
      accesses: (row.accesses || []).map((access) => ({
        id: access.membership_id,
        clientId: access.client_id,
        projectId: access.project_id,
        projectName: access.project_name || projectById[access.project_id]?.name || access.project_id,
        allowedPages: Array.isArray(access.allowed_pages) ? access.allowed_pages : [],
        rowVersion: Number(access.row_version || 0),
      })),
    })),
    pageOptions: Array.isArray(data.pageOptions) ? data.pageOptions : [],
    generatedAt: envelope?.generatedAt || null,
  };
}

export function bootstrapViewModel(envelope) {
  const data = envelope?.data || {};
  const clientRows = (Array.isArray(data.clients) ? data.clients : []).filter((row) => !Boolean(row.is_demo));
  const visibleClientIds = new Set(clientRows.map((row) => row.client_id));
  const projectRows = (Array.isArray(data.projects) ? data.projects : []).filter((row) => visibleClientIds.has(row.client_id));
  const clients = clientRows.map((row) => ({
    id: row.client_id,
    name: row.display_name || row.client_id,
    descriptor: "마케팅 운영",
    projectId: projectRows.find((project) => project.client_id === row.client_id)?.project_id || null,
    status: row.status_code === "ACTIVE" ? "active" : "planned",
  }));
  const clientsById = Object.fromEntries(clients.map((client) => [client.id, client]));
  const projects = Object.fromEntries(projectRows.map((row) => [
    row.project_id,
    projectShell(row, clientsById, envelope?.generatedAt),
  ]));
  const currentUser = data.currentUser || envelope?.actor || null;
  const initialRow = data.initial || null;
  const initialProjectId = initialRow?.projectId || initialRow?.project_id || null;
  const initialEnvelope = initialRow ? {
    ...envelope,
    scope: { ...(envelope?.scope || {}), projectId: initialProjectId },
    data: initialRow.payload || {},
  } : null;
  let initial = null;
  if (initialEnvelope && initialRow.view === "overview" && projects[initialProjectId]) {
    initial = { view: "overview", projectId: initialProjectId, data: overviewViewModel(initialEnvelope, projects[initialProjectId]) };
  } else if (initialEnvelope && initialRow.view === "tasks" && projects[initialProjectId]) {
    initial = { view: "tasks", projectId: initialProjectId, data: tasksViewModel(initialEnvelope) };
  }

  return {
    clients: clients.filter((client) => client.projectId),
    projects,
    channels: Array.isArray(data.channels) ? data.channels : [],
    actor: currentUser ? {
      id: currentUser.userId,
      name: currentUser.displayName || "사용자",
      roleCode: currentUser.role,
      role: actorRole(currentUser.role),
      organization: currentUser.organization || null,
    } : null,
    initial,
    generatedAt: envelope?.generatedAt || null,
  };
}

function activityViewModel(row) {
  const entity = String(row.entity_type || "").toLowerCase();
  const type = entity === "content" ? "content" : entity === "approval" ? "schedule" : entity === "task" ? "task" : "metric";
  const actionCode = String(row.action_code || "").toUpperCase();
  const rawChanges = Array.isArray(row.changes) ? row.changes : [];
  const changes = rawChanges.map((change) => {
    const field = String(change?.field || "");
    const providedLabel = String(change?.label || "").trim();
    return {
      field,
      label: providedLabel && providedLabel !== field ? providedLabel : ACTIVITY_FIELD_LABELS[field] || providedLabel || field || "변경값",
      before: activityChangeValue(field, change?.before),
      after: activityChangeValue(field, change?.after),
    };
  });
  const completesTask = actionCode === "UPDATED" && rawChanges.some((change) => (
    String(change?.field || "") === "status_code" && ["DONE", "COMPLETED"].includes(String(change?.after || "").toUpperCase())
  ));
  const actorDisplayName = String(row.actor_display_name || row.actor_name || "").trim();
  return {
    id: row.event_id || row.id,
    type,
    entityId: row.entity_id || null,
    taskTitle: row.task_title || row.entity_title || "",
    title: row.summary || "프로젝트 항목이 변경됨",
    actionCode,
    action: completesTask ? "완료" : ACTIVITY_ACTION_LABELS[actionCode] || "변경",
    actor: actorDisplayName || row.actor_user_id || "확인되지 않은 사용자",
    userInitiated: row.user_initiated === true || String(row.user_initiated).toLowerCase() === "true" || Boolean(actorDisplayName),
    changes,
    createdAt: row.created_at || null,
    meta: relativeTimestamp(row.created_at),
    internalMeta: "활동로그",
  };
}

function overviewKpi(row) {
  return {
    id: row.kpi_id,
    name: row.metric_name || codeLabel(row.metric_code, {}),
    value: Number(row.actual_value || 0),
    target: Number(row.target_value || 0),
    unit: codeLabel(row.unit_code, UNIT_LABELS, ""),
    source: codeLabel(row.channel_code, CHANNEL_LABELS, "원장 집계"),
    state: row.actual_value === null || row.actual_value === undefined ? "데이터 없음" : "측정 중",
  };
}

export function overviewViewModel(envelope, fallbackProject) {
  const data = envelope?.data || {};
  const summary = data.summary || {};
  const taskSummary = summary.tasks || {};
  const contentSummary = summary.contents || {};
  const approvalSummary = summary.approvals || {};
  const base = fallbackProject || {};
  const project = {
    ...base,
    ...(data.project ? projectShell(data.project, { [data.project.client_id]: { name: base.clientName } }, envelope?.generatedAt) : {}),
    allowedPages: base.allowedPages || ["overview", "plan", "tasks", "progress", "daily", "performance", "files"],
  };

  project.metrics = [
    { label: "전체 업무", value: `${taskSummary.total || 0}건`, helper: `완료 ${taskSummary.done || 0}건`, progress: taskSummary.total ? Math.round((taskSummary.done || 0) / taskSummary.total * 100) : 0, tone: "blue" },
    { label: "진행 업무", value: `${taskSummary.inProgress || 0}건`, helper: taskSummary.blocked ? `차단 ${taskSummary.blocked}건` : "현재 진행 중", progress: null, tone: "warning" },
    { label: "발행 콘텐츠", value: `${contentSummary.published || 0} / ${contentSummary.total || 0}`, helper: `검수 ${contentSummary.inReview || 0}건`, progress: contentSummary.total ? Math.round((contentSummary.published || 0) / contentSummary.total * 100) : 0, tone: "success" },
    { label: "승인 대기", value: `${approvalSummary.pending || 0}건`, helper: `승인 ${approvalSummary.approved || 0}건`, progress: null, tone: "blue" },
  ];
  project.phases = (data.phases || []).map((item) => ({
    id: item.code,
    code: codeLabel(item.code, PHASE_LABELS),
    label: "등록 업무",
    tasks: `${item.count}건`,
    output: "원장 기준",
    progress: null,
    state: item.code === data.project?.phase_code ? "current" : "listed",
  }));
  project.workstreams = (data.workstreams || []).map((item) => ({
    id: String(item.code || "").toLowerCase(),
    name: codeLabel(item.code, WORKSTREAM_LABELS),
    summary: "등록 업무",
    count: Number(item.count || 0),
    progress: null,
    color: "#2563eb",
  }));
  project.attention = approvalSummary.pending ? [{
    id: "approval-pending",
    title: `검수 대기 ${approvalSummary.pending}건`,
    detail: "고객 확인이 필요한 콘텐츠 또는 업무가 있습니다.",
    owner: "프로젝트 담당자",
    due: "확인 필요",
    level: "검수 대기",
  }] : [];

  return {
    project,
    kpis: (data.kpis || []).map(overviewKpi),
    activities: (data.recentActivity || []).map(activityViewModel),
    generatedAt: envelope?.generatedAt || null,
  };
}

export function tasksViewModel(envelope) {
  const data = envelope?.data || {};
  const orderedRows = (data.items || []).slice().sort((left, right) => {
    const leftOrder = left.sort_order === undefined || left.sort_order === null || left.sort_order === "" ? Number.MAX_SAFE_INTEGER : numberFrom(left.sort_order);
    const rightOrder = right.sort_order === undefined || right.sort_order === null || right.sort_order === "" ? Number.MAX_SAFE_INTEGER : numberFrom(right.sort_order);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.task_id || "").localeCompare(String(right.task_id || ""));
  });
  return {
    items: orderedRows.map((row) => {
      const responsibleOrganization = taskResponsibleOrganization(row.responsible_org_code);
      const effectiveState = effectiveTaskScheduleState(row);
      return {
        id: row.task_id,
        sourceTaskId: row.source_task_id || null,
        phaseCode: String(row.phase_code || "").toUpperCase(),
        phase: codeLabel(row.phase_code, PHASE_LABELS),
        streamCode: String(row.workstream_code || "").toUpperCase(),
        stream: codeLabel(row.workstream_code, WORKSTREAM_LABELS),
        title: row.title || "제목 없는 업무",
        statusMode: effectiveState.statusMode,
        statusAutomatic: effectiveState.automatic,
        statusCode: effectiveState.statusCode,
        status: codeLabel(effectiveState.statusCode, STATUS_LABELS),
        priorityCode: String(row.priority_code || "NORMAL").toUpperCase(),
        priority: codeLabel(row.priority_code, PRIORITY_LABELS),
        owner: ownerLabel(row.responsible_org_code, row.assignee_user_id),
        responsibleOrgCode: responsibleOrganization.code,
        responsibleOrg: responsibleOrganization.label,
        due: dateOnly(row.due_date),
        dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
        plannedStartDate: row.planned_start_date ? String(row.planned_start_date).slice(0, 10) : null,
        scheduleDates: normalizeScheduleDates(row.schedule_dates_json),
        completedAt: row.completed_at || null,
        completedDate: row.completed_at ? String(row.completed_at).slice(0, 10) : null,
        overdueHoldResolvedAt: row.overdue_hold_resolved_at || null,
        clientVisible: true,
        categoryCode: String(row.category_code || "").toUpperCase(),
        category: row.category_code ? codeLabel(row.category_code, {}) : "업무",
        parent: row.category_code ? codeLabel(row.category_code, {}) : "업무",
        planWeek: row.plan_week === undefined || row.plan_week === null || row.plan_week === "" ? null : numberFrom(row.plan_week),
        contractLinked: Boolean(row.contract_linked || row.plan_note),
        planNote: row.plan_note || null,
        description: row.description || "",
        assignee: row.assignee_user_id || null,
        blocker: row.blocker_reason || "",
        customerStatus: row.customer_status_text || "",
        progressPercent: effectiveState.progressPercent,
        completionUrl: row.completion_url || "",
        remarks: row.remarks || "",
        sourceCode: row.source_code || "",
        sortOrder: row.sort_order === undefined || row.sort_order === null || row.sort_order === "" ? null : numberFrom(row.sort_order),
        visibilityCode: String(row.visibility_code || "").toUpperCase(),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        rowVersion: row.row_version,
      };
    }),
    members: (data.members || []).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name || row.user_id || "이름 미등록",
      organizationCode: String(row.organization_code || "").toUpperCase(),
      organization: ORG_LABELS[String(row.organization_code || "").toUpperCase()] || String(row.organization_code || ""),
      roleCode: String(row.role_code || "").toUpperCase(),
      permissionCode: String(row.permission_code || "").toUpperCase(),
    })).filter((member) => member.userId),
    issues: (data.issues || []).map(projectIssueViewModel),
    issueCanWrite: data.issueCanWrite === true,
    total: Number(data.totalMatching || 0),
    nextCursor: data.nextCursor || null,
    project: data.project ? {
      id: data.project.project_id || null,
      phaseCode: String(data.project.phase_code || "").toUpperCase(),
      phase: codeLabel(data.project.phase_code, PHASE_LABELS),
      startDate: data.project.start_date ? String(data.project.start_date).slice(0, 10) : null,
      endDate: data.project.end_date ? String(data.project.end_date).slice(0, 10) : null,
      rowVersion: Number(data.project.row_version || 0),
      quoteData: data.project.quote_data && typeof data.project.quote_data === "object" ? data.project.quote_data : null,
    } : null,
    publishing: publishingViewModel(data.publishing || data.publicationSummary || {}),
    generatedAt: envelope?.generatedAt || null,
  };
}

export function projectIssueViewModel(row = {}) {
  return {
    id: row.issue_id,
    date: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    kind: row.kind_text || "",
    relatedTask: row.related_task_text || "",
    body: row.body_text || "",
    owner: row.owner_text || "",
    requester: row.requester_text || row.author_name || "확인되지 않은 사용자",
    statusCode: String(row.status_code || "IN_PROGRESS").toUpperCase(),
    completionUrl: row.completion_url || "",
    remarks: row.remarks || "",
    visibilityCode: String(row.visibility_code || "CLIENT").toUpperCase(),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    rowVersion: Number(row.row_version || 0),
  };
}

export function dailyMeetingsViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    items: (data.items || []).map((row) => ({
      id: row.meeting_id,
      date: row.meeting_date ? String(row.meeting_date).slice(0, 10) : null,
      title: row.title || "제목 없는 회의",
      attendees: row.attendees_text || "",
      discussion: row.discussion_text || "",
      decisions: row.decisions_text || "",
      actionItems: row.action_items_text || "",
      authorId: row.created_by_user_id || null,
      authorName: row.author_name || "확인되지 않은 사용자",
      visibilityCode: String(row.visibility_code || "PROJECT_TEAM").toUpperCase(),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      rowVersion: Number(row.row_version || 0),
    })),
    total: Number(data.totalMatching || 0),
    generatedAt: envelope?.generatedAt || null,
  };
}

export function operationsDashboardViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    range: {
      from: data.range?.from ? String(data.range.from).slice(0, 10) : null,
      to: data.range?.to ? String(data.range.to).slice(0, 10) : null,
    },
    projects: (data.projects || []).map((row) => ({
      id: String(row.project_id),
      clientId: String(row.client_id),
      clientName: row.client_name || "고객사",
      name: row.project_name || "프로젝트",
      statusCode: String(row.status_code || "ACTIVE").toUpperCase(),
      phaseCode: String(row.phase_code || "").toUpperCase(),
      startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
      endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
      totalTasks: Number(row.total_tasks || 0),
      doneTasks: Number(row.done_tasks || 0),
      inProgressTasks: Number(row.in_progress_tasks || 0),
      onHoldTasks: Number(row.on_hold_tasks || 0),
      overdueTasks: Number(row.overdue_tasks || 0),
      nextDueDate: row.next_due_date ? String(row.next_due_date).slice(0, 10) : null,
    })),
    weeklyTasks: (data.weekly_tasks || []).map((row) => ({
      id: String(row.task_id), projectId: String(row.project_id), clientName: row.client_name || "고객사", projectName: row.project_name || "프로젝트",
      title: row.title || "제목 없는 업무", description: row.description || "", workstreamCode: String(row.workstream_code || "").toUpperCase(),
      responsibleOrgCode: String(row.responsible_org_code || "").toUpperCase(), statusCode: String(row.status_code || "NOT_STARTED").toUpperCase(),
      progressPercent: Number(row.progress_percent || 0), progressDeltaToday: Math.max(0, Number(row.progress_delta_today) || 0), plannedStartDate: row.planned_start_date ? String(row.planned_start_date).slice(0, 10) : null,
      dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null, updatedAt: row.updated_at || null,
    })),
    issues: (data.issues || []).map((row) => ({
      id: String(row.issue_id), projectId: String(row.project_id), clientName: row.client_name || "고객사", projectName: row.project_name || "프로젝트",
      date: row.issue_date ? String(row.issue_date).slice(0, 10) : null, dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
      kind: row.kind_text || "확인 요청", relatedTask: row.related_task_text || "", body: row.body_text || "", owner: row.owner_text || "미지정",
      requester: row.requester_text || row.author_name || "확인되지 않은 사용자", createdAt: row.created_at || null,
      statusCode: String(row.status_code || "IN_PROGRESS").toUpperCase(), completionUrl: row.completion_url || "", remarks: row.remarks || "",
      visibilityCode: String(row.visibility_code || "CLIENT").toUpperCase(), rowVersion: Number(row.row_version || 0), updatedAt: row.updated_at || null,
    })),
    meetings: (data.meetings || []).map((row) => ({
      id: String(row.meeting_id), projectId: String(row.project_id), clientName: row.client_name || "고객사", projectName: row.project_name || "프로젝트",
      date: row.meeting_date ? String(row.meeting_date).slice(0, 10) : null, title: row.title || "회의록", attendees: row.attendees_text || "",
      discussion: row.discussion_text || "", decisions: row.decisions_text || "", actionItems: row.action_items_text || "", authorName: row.author_name || "확인되지 않은 사용자",
      updatedAt: row.updated_at || null,
    })),
    generatedAt: data.generated_at || envelope?.generatedAt || null,
  };
}

export function credentialsViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    items: (data.items || []).map((row) => ({
      id: row.credential_id,
      projectId: row.project_id,
      siteName: row.site_name || "이름 없는 사이트",
      siteUrl: row.site_url || "",
      accountIdentifier: row.account_identifier || "",
      notes: row.notes || "",
      createdByUserId: row.created_by_user_id || null,
      createdByName: row.created_by_name || "확인되지 않은 사용자",
      updatedByUserId: row.updated_by_user_id || null,
      updatedByName: row.updated_by_name || "확인되지 않은 사용자",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      rowVersion: Number(row.row_version || 0),
    })),
    total: Number(data.totalMatching || 0),
    canWrite: data.canWrite === true,
    generatedAt: envelope?.generatedAt || null,
  };
}

export function planViewModel(envelope) {
  const data = envelope?.data || {};
  const plan = data.plan || {};
  const sections = (Array.isArray(data.sections) ? data.sections : [])
    .map((section, index) => ({
      id: String(section.id || section.planSectionId || section.plan_section_id || section.code || section.sectionCode || section.section_code || `section-${index + 1}`),
      code: String(section.navLabel || section.nav_label || section.code || section.sectionCode || section.section_code || "").trim(),
      title: String(section.title || `실행계획 ${index + 1}`).trim(),
      order: Number.isFinite(Number(section.order ?? section.sortOrder ?? section.sort_order)) ? Number(section.order ?? section.sortOrder ?? section.sort_order) : index + 1,
      bodyHtml: String(section.bodyHtml || section.body_html || ""),
      updatedAt: section.updatedAt || section.updated_at || null,
    }))
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "ko"));

  return {
    project: data.project || null,
    id: String(plan.planId || plan.plan_id || "").trim(),
    title: String(plan.title || "").trim(),
    summary: String(plan.summary || "").trim(),
    sourceVersion: String(data.sourceVersion || plan.versionLabel || plan.version_label || "").trim(),
    updatedAt: data.updatedAt || plan.updatedAt || plan.updated_at || envelope?.generatedAt || null,
    updatedAtLabel: relativeTimestamp(data.updatedAt || plan.updatedAt || plan.updated_at || envelope?.generatedAt),
    sections,
  };
}

export function contentsViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    items: (data.items || []).map((row) => ({
      id: row.content_id,
      channel: codeLabel(row.channel_code, CHANNEL_LABELS),
      format: codeLabel(row.format_code, FORMAT_LABELS),
      title: row.title || "제목 없는 콘텐츠",
      status: codeLabel(row.status_code, STATUS_LABELS),
      date: dateOnly(row.publish_due_date || row.planned_date || row.published_at),
      owner: row.assignee_user_id || "담당자 미정",
      visible: true,
      url: row.publish_url || null,
      rowVersion: row.row_version,
    })),
    total: Number(data.totalMatching || 0),
    nextCursor: data.nextCursor || null,
    range: data.range || null,
    generatedAt: envelope?.generatedAt || null,
  };
}

export function performanceViewModel(envelope) {
  const data = envelope?.data || {};
  const latest = {};
  (data.actuals || []).forEach((row) => {
    const current = latest[row.kpi_id];
    if (!current || String(row.period_end || "") > String(current.period_end || "")) latest[row.kpi_id] = row;
  });
  const items = (data.definitions || []).map((row) => {
    const actual = latest[row.kpi_id];
    return {
      id: row.kpi_id,
      name: row.metric_name || codeLabel(row.metric_code, {}),
      weight: 0,
      value: Number(actual?.actual_value || 0),
      target: Number(row.target_value || 0),
      unit: codeLabel(row.unit_code, UNIT_LABELS, ""),
      unitCode: row.unit_code || "COUNT",
      periodTypeCode: row.period_type_code || "MONTHLY",
      channelCode: row.channel_code || "",
      customerVisible: row.customer_visible !== false && String(row.customer_visible).toLowerCase() !== "false",
      rowVersion: Number(row.row_version || 0),
      source: actual?.source_code || codeLabel(row.channel_code, CHANNEL_LABELS, "원장 집계"),
      state: actual ? "측정 중" : "데이터 없음",
    };
  });
  return {
    items,
    channels: Array.isArray(data.channels) ? data.channels : [],
    daily: Array.isArray(data.daily) ? data.daily : [],
    range: data.range || null,
    generatedAt: envelope?.generatedAt || null,
  };
}

export function performanceTrackingViewModel(envelope) {
  const data = envelope?.data || {};
  const numericFields = ["spend", "impressions", "reach", "video_views", "watch_time_sec", "engagements", "saves", "followers_delta", "clicks", "inquiries", "leads", "reservations", "conversions", "revenue"];
  const metrics = (row = {}) => Object.fromEntries(numericFields.map((field) => [field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), Number(row[field] ?? row[field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] ?? 0)]));
  return {
    source: data.source || "12_성과일별",
    dataAvailable: Array.isArray(data.daily) && data.daily.length > 0,
    range: data.range || null,
    execution: {
      total: Number(data.execution?.total || 0),
      done: Number(data.execution?.done || 0),
      active: Number(data.execution?.active || 0),
      blocked: Number(data.execution?.blocked || 0),
    },
    publishing: {
      total: Number(data.publishing?.total || 0),
      published: Number(data.publishing?.published || 0),
      inReview: Number(data.publishing?.inReview ?? data.publishing?.in_review ?? 0),
      approvalsPending: Number(data.publishing?.approvalsPending ?? data.publishing?.approvals_pending ?? 0),
    },
    totals: metrics(data.totals),
    daily: (data.daily || []).map((row) => ({ date: String(row.date || row.performance_date || "").slice(0, 10), ...metrics(row) })),
    channels: (data.channels || []).map((row) => ({
      channelCode: row.channelCode || row.channel_code || "UNKNOWN",
      label: row.label || codeLabel(row.channelCode || row.channel_code, CHANNEL_LABELS, "채널 미지정"),
      ...metrics(row),
    })),
    goals: (data.goals || []).map((row) => ({
      id: row.kpi_id,
      name: row.metric_name || "이름 없는 KPI",
      unit: codeLabel(row.unit_code, UNIT_LABELS, ""),
      target: Number(row.target_value || 0),
      value: row.actual_value === null || row.actual_value === undefined ? null : Number(row.actual_value),
      periodEnd: row.period_end || null,
    })),
    generatedAt: envelope?.generatedAt || null,
  };
}

export function filesViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    items: (data.items || []).map((row) => ({
      id: row.file_id,
      type: codeLabel(row.file_type_code, {}),
      title: row.title || row.source_filename || "자료",
      date: relativeTimestamp(row.updated_at || row.created_at),
      visibility: codeLabel(row.visibility_code, { CLIENT: "고객 공개", PROJECT_TEAM: "프로젝트 팀", POCKET_ONLY: "포켓 전용" }, "프로젝트 팀"),
      url: row.url || null,
    })),
    total: Number(data.totalMatching || 0),
    nextCursor: data.nextCursor || null,
    generatedAt: envelope?.generatedAt || null,
  };
}

export function activityListViewModel(envelope) {
  const data = envelope?.data || {};
  return {
    // 세부 로그는 원본 감사 이력을 보존한다. 사람이 읽는 업무 로그 정리는
    // 현재 업무명과 대조할 수 있는 화면 계층에서 별도로 수행한다.
    items: (data.items || []).map(activityViewModel),
    nextCursor: data.nextCursor || null,
    loadedCount: Number(data.loadedCount ?? data.items?.length ?? 0),
    generatedAt: envelope?.generatedAt || null,
  };
}

function workspaceEnvelope(envelope, value) {
  const nested = value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "data")
    ? value
    : { data: value };
  return {
    ...nested,
    generatedAt: nested.generatedAt || envelope?.generatedAt || null,
  };
}

function workspaceValue(data, ...keys) {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(data, candidate));
  return key === undefined ? undefined : data[key];
}

/**
 * Normalize a project_snapshot response into the same per-view models used by
 * the existing lazy endpoints. Missing keys are deliberately ignored so a
 * staged/partial backend response can still warm the views it contains.
 */
export function workspaceViewModel(envelope, fallbackProject) {
  const data = envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
  const result = {};
  const overview = workspaceValue(data, "overview", "project_overview");
  const plan = workspaceValue(data, "plan", "project_plan");
  const internalPlan = workspaceValue(data, "internalPlan", "internal_plan");
  const tasks = workspaceValue(data, "tasks");
  const contents = workspaceValue(data, "contents", "content");
  const performance = workspaceValue(data, "performance");
  const tracking = workspaceValue(data, "tracking", "performance_tracking");
  const files = workspaceValue(data, "files");
  const activity = workspaceValue(data, "activity", "activities");

  if (overview !== undefined) result.overview = overviewViewModel(workspaceEnvelope(envelope, overview), fallbackProject);
  if (plan !== undefined) result["plan-client"] = planViewModel(workspaceEnvelope(envelope, plan));
  if (internalPlan !== undefined) result["plan-internal"] = planViewModel(workspaceEnvelope(envelope, internalPlan));
  if (tasks !== undefined) result.tasks = tasksViewModel(workspaceEnvelope(envelope, tasks));
  if (contents !== undefined) result.content = contentsViewModel(workspaceEnvelope(envelope, contents));
  if (performance !== undefined) result.performance = performanceViewModel(workspaceEnvelope(envelope, performance));
  if (tracking !== undefined) result.tracking = performanceTrackingViewModel(workspaceEnvelope(envelope, tracking));
  if (files !== undefined || activity !== undefined) {
    result.files = {
      files: filesViewModel(workspaceEnvelope(envelope, files || {})),
      activities: activityListViewModel(workspaceEnvelope(envelope, activity || {})),
    };
  }
  return result;
}
