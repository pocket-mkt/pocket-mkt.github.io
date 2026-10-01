import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://pockethjs-sketch.github.io",
  "https://pocket-mkt.github.io",
  "http://127.0.0.1:8767",
  "http://localhost:8767",
]);
const PAGE_OPTIONS = ["overview", "plan", "tasks", "progress", "daily", "performance", "reports"];

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://pockethjs-sketch.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function fail(req: Request, status: number, code: string, message: string) {
  return response(req, status, { ok: false, error: { code, message } });
}

function alias(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizePages(value: unknown) {
  const values = Array.isArray(value) ? value.map((item) => String(item || "").toLowerCase()) : [];
  return PAGE_OPTIONS.filter((page) => values.includes(page));
}

async function allUsers(admin: ReturnType<typeof createClient>) {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 1000) break;
  }
  return users;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST 요청만 허용됩니다.");

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !publicKey || !serviceKey || !authorization.startsWith("Bearer ")) return fail(req, 401, "unauthorized", "인증이 필요합니다.");

  const authClient = createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.slice(7);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return fail(req, 401, "unauthorized", "유효한 로그인이 필요합니다.");
  const { data: actor } = await admin.from("profiles").select("id,organization_code,role_code,status_code,archived_at").eq("id", authData.user.id).maybeSingle();
  const pocketManager = actor?.organization_code === "POCKET" && actor?.role_code === "POCKET_MANAGER";
  const nsManager = actor?.organization_code === "NS" && actor?.role_code === "EXECUTOR_EDITOR";
  if (!actor || (!pocketManager && !nsManager) || actor.status_code !== "ACTIVE" || actor.archived_at) {
    return fail(req, 403, "forbidden", "권한이 있는 포켓·NS 운영자만 접근할 수 있습니다.");
  }

  let manageableProjectIds: Set<string> | null = null;
  if (nsManager) {
    const { data: memberships, error } = await admin
      .from("project_memberships")
      .select("project_id")
      .eq("user_id", actor.id)
      .eq("status_code", "ACTIVE")
      .is("archived_at", null)
      .in("permission_code", ["ADMIN", "EDIT"]);
    if (error) return fail(req, 500, "read_failed", "NS 프로젝트 관리 범위를 확인하지 못했습니다.");
    manageableProjectIds = new Set((memberships || []).map((membership) => String(membership.project_id)));
  }
  const canManageProject = (projectId: unknown) => manageableProjectIds === null || manageableProjectIds.has(String(projectId));

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(req, 400, "invalid_input", "JSON 본문이 필요합니다."); }
  const operation = String(body.operation || "READ").toUpperCase();

  try {
    const loadView = async () => {
      const [{ data: clients, error: clientsError }, { data: projects, error: projectsError }, { data: profiles, error: profilesError }, { data: memberships, error: membershipsError }, authUsers] = await Promise.all([
        admin.from("clients").select("id,legacy_id,display_name,status_code").is("archived_at", null).order("id"),
        admin.from("projects").select("id,legacy_id,client_id,project_name,status_code").is("archived_at", null).order("id"),
        admin.from("profiles").select("id,legacy_id,display_name,status_code").eq("role_code", "CLIENT_VIEWER").is("archived_at", null).order("display_name"),
        admin.from("project_memberships").select("id,project_id,user_id,permission_code,allowed_pages,status_code,row_version,archived_at").order("id"),
        allUsers(admin),
      ]);
      const readError = clientsError || projectsError || profilesError || membershipsError;
      if (readError) throw readError;
      const visibleProjects = (projects || []).filter((project) => canManageProject(project.id));
      const visibleProjectIds = new Set(visibleProjects.map((project) => String(project.id)));
      const visibleClientIds = new Set(visibleProjects.map((project) => String(project.client_id)));
      const visibleMemberships = (memberships || []).filter((membership) => visibleProjectIds.has(String(membership.project_id)));
      const projectById = new Map(visibleProjects.map((project) => [String(project.id), project]));
      const authById = new Map(authUsers.map((user) => [user.id, user]));
      return {
        clients: (clients || []).filter((client) => visibleClientIds.has(String(client.id))).map((client) => ({ client_id: client.legacy_id || String(client.id), display_name: client.display_name, status_code: client.status_code })),
        projects: visibleProjects.map((project) => ({ project_id: project.legacy_id || String(project.id), client_id: (clients || []).find((client) => client.id === project.client_id)?.legacy_id || String(project.client_id), client_name: (clients || []).find((client) => client.id === project.client_id)?.display_name || '', project_name: project.project_name, status_code: project.status_code })),
        accounts: (profiles || []).map((profile) => {
          const user = authById.get(profile.id);
          const accesses = visibleMemberships.filter((membership) => membership.user_id === profile.id && !membership.archived_at).map((membership) => {
            const project = projectById.get(String(membership.project_id));
            const client = (clients || []).find((item) => item.id === project?.client_id);
            return {
              membership_id: String(membership.id),
              client_id: client?.legacy_id || String(project?.client_id || ""),
              project_id: project?.legacy_id || String(membership.project_id),
              project_name: project?.project_name || "",
              client_name: client?.display_name || '',
              permission_code: membership.permission_code,
              allowed_pages: membership.allowed_pages || [],
              row_version: membership.row_version,
            };
          });
          return {
            user_id: profile.legacy_id || profile.id,
            account: String(user?.email || "").replace(/@hub\.local$/i, ""),
            email: user?.email || "",
            display_name: profile.display_name,
            status_code: profile.status_code,
            accesses,
          };
        }).filter((profile) => pocketManager || profile.accesses.length > 0),
        pageOptions: PAGE_OPTIONS,
      };
    };

    if (operation === "READ") return response(req, 200, { ok: true, generatedAt: new Date().toISOString(), data: await loadView() });
    if (!["UPSERT", "DISABLE", "REMOVE_ACCESS"].includes(operation)) return fail(req, 400, "invalid_input", "지원하지 않는 권한 작업입니다.");

    const input = (body.account && typeof body.account === "object" ? body.account : {}) as Record<string, unknown>;
    const account = alias(input.account);
    const email = `${account}@hub.local`;
    const projectLegacyId = String(input.projectId || input.project_id || "").trim();
    const displayName = String(input.displayName || input.display_name || "").trim();
    const password = String(input.accessCode || input.access_code || "");
    const pages = normalizePages(input.allowedPages || input.allowed_pages);
    if (!/^[a-z0-9._-]{2,40}$/.test(account) || !projectLegacyId) return fail(req, 400, "invalid_input", "아이디와 프로젝트를 확인해 주세요.");

    const { data: project, error: projectError } = await admin.from("projects").select("id,legacy_id,client_id,status_code").eq(/^[1-9]\d*$/.test(projectLegacyId) ? "id" : "legacy_id", projectLegacyId).is("archived_at", null).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return fail(req, 404, "not_found", "프로젝트를 찾지 못했습니다.");
    if (project.status_code === 'DISABLED') return fail(req, 400, 'invalid_input', '중지된 프로젝트에는 권한을 배정할 수 없습니다.');
    if (!canManageProject(project.id)) return fail(req, 403, "forbidden", "이 프로젝트의 고객 권한을 관리할 수 없습니다.");
    if (operation === "DISABLE" && !pocketManager) return fail(req, 403, "forbidden", "전체 계정 비활성화는 포켓 관리자만 할 수 있습니다.");
    const users = await allUsers(admin);
    let authUser = users.find((user) => String(user.email || "").toLowerCase() === email) || null;
    let targetProfile: Record<string, unknown> | null = null;
    if (authUser) {
      const { data, error } = await admin.from('profiles').select('id,organization_code,role_code,status_code,archived_at').eq('id',authUser.id).maybeSingle();
      if (error) throw error;
      targetProfile = data;
      if (!targetProfile || targetProfile.organization_code !== 'CLIENT' || targetProfile.role_code !== 'CLIENT_VIEWER' || targetProfile.archived_at) {
        return fail(req,403,'forbidden','이 화면에서는 기존 고객 계정만 수정할 수 있습니다. 내부 운영 계정은 변경할 수 없습니다.');
      }
      if (nsManager && operation === 'UPSERT' && (input.enabled !== false) !== (targetProfile.status_code === 'ACTIVE')) {
        return fail(req,403,'forbidden','전체 계정 상태 변경은 포켓 관리자만 할 수 있습니다.');
      }
    }
    if (nsManager && authUser) {
      const scopedIds = [...(manageableProjectIds || [])];
      if (!scopedIds.length) return fail(req, 403, "forbidden", "관리 가능한 프로젝트가 없습니다.");
      const { data: scopedAccess, error: scopedAccessError } = await admin
        .from("project_memberships")
        .select("id")
        .eq("user_id", authUser.id)
        .eq("status_code", "ACTIVE")
        .is("archived_at", null)
        .in("project_id", scopedIds)
        .limit(1);
      if (scopedAccessError) throw scopedAccessError;
      if (!scopedAccess?.length) return fail(req, 403, "forbidden", "이 고객 계정은 NS 관리 범위 밖에 있습니다.");
    }

    if (operation === "REMOVE_ACCESS") {
      if (!authUser) return fail(req, 404, "not_found", "계정을 찾지 못했습니다.");
      let query = admin.from("project_memberships").update({ status_code: "DISABLED", archived_at: new Date().toISOString() }).eq("user_id", authUser.id).eq("project_id", project.id).is("archived_at", null);
      if (input.membershipId || input.membership_id) query = query.eq("id", String(input.membershipId || input.membership_id));
      const { data: removed, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!removed) return fail(req, 404, "not_found", "프로젝트 권한을 찾지 못했습니다.");
      return response(req, 200, { ok: true, generatedAt: new Date().toISOString(), data: { saved: true, removed: true } });
    }

    const { data: existingMembership, error: membershipReadError } = authUser
      ? await admin.from('project_memberships').select('id,row_version').eq('project_id',project.id).eq('user_id',authUser.id).maybeSingle()
      : {data:null,error:null};
    if (membershipReadError) throw membershipReadError;
    if (input.membershipId && String(input.membershipId) !== String(existingMembership?.id || '')) return fail(req,409,'conflict','선택한 프로젝트와 권한 행이 일치하지 않습니다. 화면을 다시 열어 주세요.');
    if (input.expectedRowVersion !== undefined && Number(input.expectedRowVersion) !== Number(existingMembership?.row_version)) return fail(req,409,'conflict','다른 운영자가 권한을 변경했습니다. 화면을 다시 열어 확인해 주세요.');
    const enabled = operation !== "DISABLE" && input.enabled !== false;
    if (!displayName || (operation === "UPSERT" && !pages.length)) return fail(req, 400, "invalid_input", "표시 이름과 허용 페이지가 필요합니다.");
    if (!authUser && password.length < 8) return fail(req, 400, "invalid_input", "신규 계정 비밀번호는 8자 이상이어야 합니다.");
    if (password && password.length < 8) return fail(req,400,'invalid_input','새 비밀번호는 8자 이상이어야 합니다.');
    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (error) throw error;
      authUser = data.user;
    } else {
      const attributes: Record<string, unknown> = { user_metadata: { ...(authUser.user_metadata || {}), display_name: displayName } };
      if (password) attributes.password = password;
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, attributes);
      if (error) throw error;
      authUser = data.user;
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authUser.id,
      legacy_id: `USR-${account.toUpperCase()}`,
      display_name: displayName,
      organization_code: "CLIENT",
      role_code: "CLIENT_VIEWER",
      status_code: enabled ? "ACTIVE" : "DISABLED",
      archived_at: null,
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    if (operation === "DISABLE") {
      const { error: disableError } = await admin
        .from("project_memberships")
        .update({ status_code: "DISABLED", archived_at: new Date().toISOString() })
        .eq("user_id", authUser.id)
        .is("archived_at", null);
      if (disableError) throw disableError;
      return response(req, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        data: { saved: true, enabled: false, account, projectId: projectLegacyId },
      });
    }

    const membershipValues = { permission_code: "READ_ONLY", allowed_pages: pages, status_code: enabled ? "ACTIVE" : "DISABLED", archived_at: enabled ? null : new Date().toISOString() };
    const membershipResult = existingMembership
      ? await admin.from("project_memberships").update(membershipValues).eq("id", existingMembership.id).eq('row_version',existingMembership.row_version).select('id').maybeSingle()
      : await admin.from("project_memberships").insert({ ...membershipValues, legacy_id: `SB-MEM-${account.toUpperCase()}-${projectLegacyId}`, project_id: project.id, user_id: authUser.id }).select('id').maybeSingle();
    if (membershipResult.error) throw membershipResult.error;
    if (!membershipResult.data) return fail(req,409,'conflict','다른 운영자가 권한을 변경했습니다. 화면을 다시 열어 주세요.');
    if (enabled) {
      const { error } = await admin.from("projects").update({ client_view_enabled: true }).eq("id", project.id);
      if (error) throw error;
    }
    return response(req, 200, { ok: true, generatedAt: new Date().toISOString(), data: { saved: true, enabled, account, projectId: projectLegacyId } });
  } catch (error) {
    console.error('[access-admin]', {code: typeof error === 'object' && error && 'code' in error ? String(error.code).slice(0,40) : 'request_failed'});
    return fail(req, 500, "save_failed", "권한 관리 요청을 처리하지 못했습니다.");
  }
});
