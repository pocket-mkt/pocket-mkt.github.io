// A write to one project must not invalidate unrelated in-flight reads.
export function invalidateResourceReads(requests, versions, cacheKey) {
  versions.set(cacheKey, (versions.get(cacheKey) || 0) + 1);
  for (const requestKey of requests.keys()) {
    if (requestKey.startsWith(`${cacheKey}:`)) requests.delete(requestKey);
  }
}

export const WORKSPACE_SUMMARY_KEYS = Object.freeze(["workspace:portfolio", "workspace:daily"]);

export function invalidateWorkspaceCaches({ cache, requests, versions, removePersisted }) {
  for (const key of WORKSPACE_SUMMARY_KEYS) {
    cache.delete(key);
    invalidateResourceReads(requests, versions, key);
    removePersisted(key);
  }
}
