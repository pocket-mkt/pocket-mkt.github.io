# KPI funnel — monthly manual entry

## Direct funnel editor (2026-09-17)

The primary UI is now an always-visible three-stage funnel with channel selection, direct visits/conversions editing and overall targets inside the stages. Percentages below recalculate from confirmed saved values. Empty months can create their first channel directly in the funnel; aggregate counts are never arbitrarily redistributed among channels. Funnel width identifies stages, not a proportional volume scale. Existing storage, authorization and monthly history are unchanged.

Written: 2026-09-16 19:55 KST.

Production route: `#performance` (label: KPI 성과). Project permissions continue to use `performance`.

- Monthly cumulative records, not daily increments. Prior months remain separate. No API collection is claimed or enabled.
- One final conversion definition per project/month; freely editable label, conversion target, inflow label/target, definition and up to 40 channels. Table cells save on Enter or blur. Escape cancels.
- Counts are integers. Blank is unknown, zero is observed zero. Totals remain unknown until all participating channel values are present. Conversions cannot exceed visits. Do not add impressions to visits.
- Flow is a visualization of manually entered aggregates, not person-level attribution. All sources merge into one inflow node. Selecting a source highlights it without pretending to reconstruct individual user paths.
- Legacy KPI definitions/values remain untouched and are available in an internal collapsed section.
- `kpi_funnels` has project/month primary key, RLS, no direct client table grants. Public SECURITY INVOKER RPC wrappers call private, authorization-checked implementations.
- Internal editing requires project write permission and performance-page permission. Customers need existing customer sharing + performance permission and the month's explicit publication flag. Customer RPC projection strips cost values; client writes are denied.
- Updates use expected row version, a transaction advisory lock, and UUID retry identity. A stale writer receives a conflict rather than overwriting. Failed cell drafts remain visible; reloading asks before discarding them.
- Before/after values, actor, version and timestamp are recorded in private `kpi_funnel_audit`. Channel removal retains its previous values there. Audit is not a new customer-visible endpoint or a claimed Detail Log UI integration.
- Charts are separately lazy-loaded; other tabs do not load ECharts on initial entry.

Validation: model/API/data-source unit tests; PGlite migration/role/validation/conflict/idempotency/audit tests; isolated Chromium at 1440/1024/390 for edits, Enter/Escape, failures, month switching, add/delete, customer visibility and overflow. Test fixtures are synthetic and never inserted in production.

Migration `20260916103043_kpi_funnel_monthly.sql` applied alone via linked CLI on 2026-09-16, then marked applied. Pending unrelated Gantt migration was not applied. Post-apply security advisors retain pre-existing public SECURITY DEFINER and leaked-password-protection warnings; this change does not claim the entire existing database is warning-free.
