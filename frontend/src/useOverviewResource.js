import { useEffect } from "react";
import { isViewAllowed } from "./accessPermissions.js";
import { overviewViewModel } from "./api/viewModel.js";

export function useOverviewResource({ source, activeProjectId, view, bootstrapState, actorRole, overviewState, pageRefreshKey, setOverviewState, setSession }) {
  useEffect(() => {
    if (!source || !activeProjectId || view !== "overview" || bootstrapState.status !== "ready") return undefined;
    const allowedPages = bootstrapState.data?.projects?.[activeProjectId]?.allowedPages || [];
    if (actorRole !== "client" || isViewAllowed("schedule", allowedPages)) return undefined;
    if (overviewState.status === "ready" && overviewState.projectId === activeProjectId && overviewState.refreshKey === pageRefreshKey) return undefined;
    const controller = new AbortController();
    setOverviewState({ status: "loading", data: null, error: null, resource: "overview", projectId: activeProjectId });
    source.overview({ projectId: activeProjectId, signal: controller.signal }).then((envelope) => {
      if (controller.signal.aborted) return;
      setOverviewState({ status: "ready", data: overviewViewModel(envelope, bootstrapState.data.projects[activeProjectId]), error: null, resource: "overview", projectId: activeProjectId, refreshKey: pageRefreshKey });
    }).catch((error) => { if (!controller.signal.aborted) { if (error.code === "unauthorized") setSession(null); setOverviewState({ status: "error", data: null, error, resource: "overview", projectId: activeProjectId, refreshKey: pageRefreshKey }); } });
    return () => controller.abort();
    // Loading/ready are outputs of this request, not reasons to abort and restart it.
  }, [source, activeProjectId, view, bootstrapState.status, bootstrapState.data, actorRole, pageRefreshKey]);
}
