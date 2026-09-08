import { useEffect } from "react";
import { isViewAllowed } from "./accessPermissions.js";
import { PLAN_VARIANTS } from "./planNavigation.js";
import { readResourceSessionCache, removeResourceSessionCache, scheduleResourceSessionCacheWrite } from "./resourceSessionCache.js";
import { PERSISTED_RESOURCES, RESOURCE_CACHE_TTL_MS } from "./resourcePolicy.js";
import { operationsDashboardViewModel, planViewModel, tasksViewModel, dailyMeetingsViewModel, credentialsViewModel, contentsViewModel, performanceTrackingViewModel, performanceViewModel, activityListViewModel, accessAdminViewModel } from "./api/viewModel.js";

export function useActiveResource({ source, activeProjectId, resourceProjectId, view, actorRole, authorizedPlanVariant, activeResource, bootstrapState, pageRefreshKey, resourceState, resourceCacheRef, resourceRequestRef, resourceCacheEpochRef, resourceVersionsRef, setResourceState, setSession, operationsDashboardRange }) {
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
        if (view === "files") return source.activity({limit:100}).then((activity) => activity.data);
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
      if (error.code === "forbidden" || error.code === "unauthorized") {
        resourceCacheRef.current.delete(cacheKey);
        removeResourceSessionCache(source.getSession(), cacheKey);
        setResourceState({ status: "error", data: null, error, resource: activeResource, projectId: resourceProjectId, refreshKey: pageRefreshKey });
      } else if (!cachedState && !visibleState) setResourceState({ status: "error", data: null, error, resource: activeResource, projectId: resourceProjectId, refreshKey: pageRefreshKey });
    });
    return () => { active = false; };
  }, [source, activeProjectId, resourceProjectId, view, actorRole, authorizedPlanVariant, activeResource, bootstrapState.status, bootstrapState.data, pageRefreshKey]);
}
