import {
  defaultSettings,
  emptyDay,
  newChannel,
  channelDay,
} from "../src/kpiDailyModel.js";
export async function verifyKpiDailySecurity(db, users, assert) {
  await db.exec("reset role;begin");
  const as = (user) =>
    db.exec(
      `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${users[user]}',false)`,
    );
  const read = async (id = 1, month = "2026-09-01") =>
    (await db.query("select public.read_kpi_daily($1,$2::date) v", [id, month]))
      .rows[0].v;
  const save = async (
    body,
    version = null,
    mutation = crypto.randomUUID(),
    kind = "DAY",
    date = "2026-09-02",
    id = 1,
  ) =>
    (
      await db.query(
        "select public.save_kpi_daily($1,$2,$3::date,$4::jsonb,$5,$6::uuid) v",
        [id, kind, date, JSON.stringify(body), version, mutation],
      )
    ).rows[0].v;
  const history = async (id = 1, cursor = null) =>
    (
      await db.query(
        "select public.read_kpi_daily_history($1,'DAY','2026-09-02',$2) v",
        [id, cursor],
      )
    ).rows[0].v;
  const rejects = async (fn, code) => {
    await db.exec("savepoint bad");
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    await db.exec("rollback to bad;release bad");
    assert(
      error?.code === code,
      `daily expected ${code}, got ${error?.code}: ${error?.message}`,
    );
  };
  try {
    await db.exec(
      `update public.projects set client_view_enabled=true where id=1;update public.project_memberships set allowed_pages=array['performance'],archived_at=null where project_id=1;update public.project_memberships set archived_at=now() where user_id='${users.ns}' and project_id<>1;`,
    );
    const legacyBefore = JSON.stringify(
      (
        await db.query(
          "select * from public.kpi_funnels order by project_id,month",
        )
      ).rows,
    );
    await as("manager");
    assert((await read()).days.length === 0, "new ledger not empty");
    const body = {
      ...emptyDay(),
      visits: 100,
      conversions: 150,
      execution: "<script>not executable</script>",
      channels: [
        { ...channelDay(newChannel("네이버", "AD", "naver")), cost: 5000 },
      ],
    };
    const mutation = crypto.randomUUID();
    let r = await save(body, null, mutation);
    assert(r.item.row_version === 1, "create failed");
    assert((await save(body, null, mutation)).replayed, "retry duplicated");
    await rejects(() => save({ ...body, extra: 1 }, 1), "22023");
    await rejects(() => save({ ...body, visits: "100" }, 1), "22023");
    await rejects(() => save({ ...body, visits: -1 }, 1), "22023");
    await rejects(() => save({ ...body, visits: 1.2 }, 1), "22023");
    await rejects(
      () =>
        save({ ...body, channels: [...body.channels, ...body.channels] }, 1),
      "22023",
    );
    await rejects(
      () =>
        save(
          {
            ...body,
            channels: [{ ...body.channels[0], link: "javascript:alert(1)" }],
          },
          1,
        ),
      "22023",
    );
    await rejects(() => save(body, 0), "40001");
    await rejects(() => save({ ...body, visits: 20 }, 1, mutation), "22023");
    await rejects(
      () => save(body, null, crypto.randomUUID(), "DAY", "2100-01-01"),
      "22023",
    );
    await rejects(
      () => db.query("select * from public.kpi_daily_records"),
      "42501",
    );
    await rejects(
      () => db.query("delete from public.kpi_daily_records"),
      "42501",
    );
    await rejects(
      () => db.query("select * from private.kpi_daily_audit"),
      "42501",
    );
    await as("ns");
    r = await save({ ...body, conversions: 10 }, 1);
    assert(r.item.row_version === 2, "NS edit denied");
    await rejects(
      () => save(body, null, crypto.randomUUID(), "DAY", "2026-09-02", 2),
      "42501",
    );
    await rejects(() => read(2), "42501");
    await rejects(() => history(2), "42501");
    await as("manager");
    r = await save(body, null, mutation);
    assert(
      r.item.row_version === 2 && r.item.body.conversions === 10,
      "retry regressed newer write",
    );
    assert((await history()).items.length === 2, "retry audit duplicate");
    let settings = {
      ...defaultSettings(),
      inflow_goal: 1000,
      conversion_goal: 100,
      channels: [newChannel("검색", "AD", "naver")],
    };
    await save(settings, null, crypto.randomUUID(), "SETTINGS", "2026-09-01");
    const inherited = await read(1, "2026-10-01");
    assert(
      inherited.inherited_settings.inflow_goal === null &&
        inherited.inherited_settings.channels[0].id === "naver",
      "settings inheritance copied monthly goals",
    );
    await rejects(
      () =>
        save(
          { ...settings, rate_enabled: true },
          1,
          crypto.randomUUID(),
          "SETTINGS",
          "2026-09-01",
        ),
      "22023",
    );
    await rejects(() => read(1, "2026-09-02"), "22023");
    for (let i = 3; i <= 13; i++)
      await save({ ...body, conversions: i }, i - 1);
    const h = await history();
    assert(h.items.length === 10 && h.next_cursor, "history not bounded");
    assert(
      (await history(1, h.next_cursor)).items.length === 3,
      "history pagination wrong",
    );
    assert(
      h.items[0].before_body.conversions === 12 &&
        h.items[0].after_body.conversions === 13,
      "audit values absent",
    );
    // Stage sheets share the audited ledger and serialize against legacy daily edits.
    await as("ns");
    const period = {
      id: "period",
      start: "2026-09-10",
      end: "2026-09-12",
      source: "GA4",
      note: "테스트",
      value: 300,
    };
    const stageBody = { entries: [period] },
      stageMutation = crypto.randomUUID();
    const saveStage = (
      body,
      version = null,
      mutation = crypto.randomUUID(),
      kind = "STAGE_2",
    ) => save(body, version, mutation, kind, "2026-09-01");
    const stageSaved = await saveStage(stageBody, null, stageMutation);
    assert(stageSaved.item.row_version === 1, "NS stage create denied");
    assert(
      (await saveStage(stageBody, null, stageMutation)).replayed,
      "stage retry duplicated",
    );
    assert(
      (await read()).stage_sheets.STAGE_2.body.entries[0].value === 300,
      "stage read missing",
    );
    await rejects(
      () =>
        saveStage(
          {
            entries: [
              period,
              {
                ...period,
                id: "overlap",
                start: "2026-09-12",
                end: "2026-09-13",
              },
            ],
          },
          1,
        ),
      "23P01",
    );
    await rejects(
      () =>
        saveStage(
          { entries: [{ ...period, start: "2026-09-02", end: "2026-09-02" }] },
          1,
        ),
      "23P01",
    );
    await rejects(
      () =>
        save(
          { ...emptyDay(), visits: 0 },
          null,
          crypto.randomUUID(),
          "DAY",
          "2026-09-11",
        ),
      "23P01",
    );
    await save(
      { ...emptyDay(), execution: "브리핑만 기록 가능" },
      null,
      crypto.randomUUID(),
      "DAY",
      "2026-09-11",
    );
    await rejects(
      () => saveStage({ entries: [{ ...period, end: "2026-10-01" }] }, 1),
      "22023",
    );
    await rejects(
      () =>
        saveStage(
          { entries: [{ ...period, start: "2026-09-31", end: "2026-09-31" }] },
          1,
        ),
      "22023",
    );
    await rejects(
      () => saveStage({ entries: [{ ...period, value: null }] }, 1),
      "22023",
    );
    await rejects(
      () => saveStage({ entries: [{ ...period, value: -1 }] }, 1),
      "22023",
    );
    await rejects(
      () => saveStage({ entries: [{ ...period, value: 100, extra: 1 }] }, 1),
      "22023",
    );
    await rejects(() => saveStage(stageBody, 0), "40001");
    const marketing = {
      id: "ad",
      start: "2026-09-10",
      end: "2026-09-12",
      source: "네이버",
      note: "",
      cost: 30000,
      impressions: 10000,
      clicks: null,
      posts: null,
    };
    await saveStage(
      { entries: [marketing, { ...marketing, id: "meta", source: "메타" }] },
      null,
      crypto.randomUUID(),
      "STAGE_1",
    );
    await rejects(
      () =>
        save(
          {
            ...emptyDay(),
            channels: [
              { ...channelDay(newChannel("네이버", "AD", "naver")), posts: 1 },
            ],
          },
          null,
          crypto.randomUUID(),
          "DAY",
          "2026-09-10",
        ),
      "23P01",
    );
    await rejects(
      () =>
        saveStage(
          {
            entries: [
              marketing,
              { ...marketing, id: "same", source: " 네이버 " },
            ],
          },
          1,
          crypto.randomUUID(),
          "STAGE_1",
        ),
      "23P01",
    );
    const goal = {
      id: "g",
      title: "예약 목표",
      metric: "conversions",
      target: 30,
      direction: "AT_LEAST",
    };
    await saveStage(
      {
        goals: Array.from({ length: 5 }, (_, i) => ({ ...goal, id: "g" + i })),
      },
      null,
      crypto.randomUUID(),
      "GOALS",
    );
    await rejects(
      () =>
        saveStage(
          {
            goals: Array.from({ length: 6 }, (_, i) => ({
              ...goal,
              id: "g" + i,
            })),
          },
          1,
          crypto.randomUUID(),
          "GOALS",
        ),
      "22023",
    );
    await rejects(
      () =>
        saveStage(
          { goals: [{ ...goal, target: 0 }] },
          1,
          crypto.randomUUID(),
          "GOALS",
        ),
      "22023",
    );
    await saveStage({ entries: [] }, 1);
    const stageHistory = (
      await db.query(
        "select public.read_kpi_daily_history(1,'STAGE_2','2026-09-01',null) v",
      )
    ).rows[0].v;
    assert(
      stageHistory.items.length === 2 &&
        stageHistory.items[0].before_body.entries.length === 1 &&
        stageHistory.items[0].after_body.entries.length === 0,
      "stage removal/retry audit incorrect",
    );
    await rejects(
      () => db.query("select private.read_kpi_daily_base(1,'2026-09-01')"),
      "42501",
    );
    await db.exec(
      `reset role;update public.project_memberships set permission_code='READ_ONLY' where project_id=1 and user_id='${users.ns}';`,
    );
    await as("ns");
    assert(!(await read()).canWrite, "reader writable");
    await rejects(() => save(body, 13), "42501");
    await rejects(() => saveStage(stageBody, 2), "42501");
    await db.exec(
      `reset role;update public.project_memberships set allowed_pages=array['tasks'] where project_id=1 and user_id='${users.ns}';`,
    );
    await as("ns");
    await rejects(() => read(), "42501");
    await rejects(() => history(), "42501");
    await as("client");
    await rejects(() => saveStage(stageBody, 2), "42501");
    await rejects(() => read(), "42501");
    await rejects(() => save(body, 13), "42501");
    await rejects(() => history(), "42501");
    await rejects(
      () => db.query("select private.read_kpi_daily(1,'2026-09-01')"),
      "42501",
    );
    await db.exec(
      "reset role;set role anon;select set_config('request.jwt.claim.sub','',false)",
    );
    await rejects(() => read(), "42501");
    await rejects(() => history(), "42501");
    await db.exec("reset role");
    assert(
      JSON.stringify(
        (
          await db.query(
            "select * from public.kpi_funnels order by project_id,month",
          )
        ).rows,
      ) === legacyBefore,
      "legacy monthly data mutated",
    );
    console.log(
      JSON.stringify({
        dailyKpi: "pass",
        nsWrite: "pass",
        clientRead: "blocked",
        versionRetryAudit: "pass",
        legacyPreserved: true,
      }),
    );
  } finally {
    await db.exec("rollback;reset role");
  }
}
