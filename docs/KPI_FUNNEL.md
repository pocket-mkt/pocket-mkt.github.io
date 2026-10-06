# KPI performance — daily ledger and legacy monthly funnel

The 2026-10-06 daily section below supersedes the default internal monthly-entry UI. Earlier sections document the preserved legacy monthly editor only.

## Stage cards (2026-09-17)

Reference: the user's Pocket KPI sheet screenshot and public `pockethjs-sketch.github.io/pocket.kpi/` site. The user explicitly retained 광고·콘텐츠 → 유입 → 전환. Replace the trapezoid with three stage panels, colored number markers, metric tiles, connecting arrows, and actual/target status. Inline editing and monthly data remain unchanged. Registered channel count is not a posting/impression count. Cost-per-visit/conversion uses all entered channel costs; missing values and zero denominators stay unavailable. No conversion-rate or cost target is fabricated. Customer cost masking remains intact.

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

# Daily performance and NS briefing (2026-10-06)

The internal performance route now starts with `KpiDailyView`. Existing monthly data and the old editor remain available under **기존 월별 자료** for the selected month. Existing customer routes continue using the old safe projection; new daily content is internal only.

## Daily workflow

1. Set monthly labels, sources, measurement definition, goals and recurring channel roster.
2. Choose the performance date (defaults to yesterday KST; future dates are not writable).
3. Enter independently measured overall visits/conversions, channel cost/impressions/clicks/posts/attributed outcomes, and optional evidence links.
4. Add execution, interpretation, next action and Pocket requests. Blur automatically saves. The month cards and trend update from acknowledged records; status shows pending/failed writes.
5. Browse other dates or the month ledger. Expand history for the author and before/after changes.

Numbers can be pasted into the channel grid from a spreadsheet. Download the standard CSV to populate and upload again; preview applies numbers and channel rows to **one selected date** without replacing narratives. Arbitrary advertising-platform files and automatic collection are not supported. The JSON error backup includes all draft fields, including narrative; it is a recovery file, not a CSV import format.

## Measurement rules

- No seeded real-looking data. Legacy monthly aggregates never count toward daily totals.
- Null/blank is unknown; zero is a measured zero. Missing dates remain visible, including weekends. No carryover of prior-day metrics.
- Overall visits/conversions are not sums of the channel attribution columns. Do not double-count conversion events across channels or devices.
- Ratios require matching recorded-day pairs, a nonzero denominator, and explicitly confirmed monthly sources/definition. They are period ratios, **not** a user-cohort conversion rate. Cost per overall conversion is labelled as such, not paid-only CAC.
- Partial sums are marked as partial. Goals are month-scoped and are not inherited. New-month channel identities and measurement definitions can inherit the latest earlier settings.
- Changes to a month's definitions intentionally change interpretation of that month's numbers. They are audited. Historical daily channel snapshots are not rewritten by roster edits.

## Data and authorization

Migration `20261006040421_kpi_daily_briefings.sql` adds one public RPC-only table keyed by `(project_id, record_kind, record_date)` and a private mutation audit. The filename matches the applied production migration version. Kinds are SETTINGS (first-of-month) and DAY. At most 31 daily records, 40 channels per record, bounded text/numbers and 60KB bodies. History is keyset-paginated in batches of 10.

Public invoker RPC wrappers delegate to private, pinned-search-path definer functions with explicit authenticated project/page checks. Direct table grants and anonymous RPC access are revoked; RLS is enabled. Customers cannot read or write daily records, including history. Existing internal performance EDIT/ADMIN permissions determine writes; readers cannot write. No membership or global-role changes.

Writes serialize per mutation and per record, validate expected row versions, and audit before/after body plus actor. Identical retries return the current canonical record without incrementing versions or duplicating audits. Reused IDs with changed envelopes and stale versions are rejected. Old monthly tables are untouched.

Browser drafts are memory-only. Failed requests retain immutable retry envelopes; conflicts require reload rather than silent overwrite. Navigation/reload is guarded. Background refresh is bounded to the current visible month and deferred during edits/writes, with focus/online and a 60-second timer; responses are discarded if editing starts during the request.

## Verification

- `tests/kpi-daily.test.mjs`: dates, unknown/zero, partial aggregation, no double-counting, CSV roundtrip/validation, formula-safe export and rectangular paste.
- `scripts/kpi-daily-security-qa.mjs`: NS/Pocket writes, client/anonymous/direct-table denial, page and tenant boundaries, versions, retry identity, full audit, history pagination and legacy preservation in PGlite.
- `scripts/kpi-daily-browser-fixture.jsx`: real headless browser editing, queued autosave, retry, conflict recovery, CSV preview, narrative escaping, project isolation, read-only and layout at 1440/1024/390 pixels.
