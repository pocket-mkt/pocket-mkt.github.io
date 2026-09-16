import { emptyFunnel } from "../src/kpiFunnelModel.js";
export async function verifyKpiFunnelSecurity(db, users, assert) {
  await db.exec("reset role; begin");
  const as = async (user) =>
    db.exec(
      `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${users[user]}',false)`,
    );
  const read = async (id = 1) =>
    (
      await db.query("select public.read_kpi_funnel($1,'2026-09-01') as v", [
        id,
      ])
    ).rows[0].v;
  const save = async (
    b,
    version = null,
    mutation = crypto.randomUUID(),
    id = 1,
  ) =>
    (
      await db.query(
        "select public.save_kpi_funnel($1,'2026-09-01',$2::jsonb,$3,$4::uuid) as v",
        [id, JSON.stringify(b), version, mutation],
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
      error && error.code === code,
      `KPI expected ${code}, got ${error?.code}: ${error?.message}`,
    );
  };
  try {
    await db.exec(
      `update public.projects set client_view_enabled=true where id=1;update public.project_memberships set allowed_pages=array['performance'],archived_at=null where project_id=1;update public.project_memberships set archived_at=now() where user_id='${users.ns}' and project_id<>1;`,
    );
    await as("manager");
    assert((await read()).item === null, "new month must be empty");
    let body = {
      ...emptyFunnel(),
      goal: 100,
      channels: [
        {
          id: "naver",
          name: "네이버",
          type: "AD",
          visits: 500,
          conversions: 20,
          cost: 10000,
        },
      ],
    };
    const mutation = crypto.randomUUID();
    let r = await save(body, null, mutation);
    assert(
      r.item?.row_version === 1 && r.item.body.goal === 100,
      "save must return saved row",
    );
    assert(
      (await save(body, null, mutation)).item.row_version === 1,
      "retry duplicated write",
    );
    await rejects(() => save({ ...body, goal: 200 }, 1, mutation), "22023");
    await rejects(() => save(body, 0), "40001");
    await rejects(() => save({ ...body, unknown: 1 }, 1), "22023");
    await rejects(
      () =>
        save({ ...body, channels: [...body.channels, ...body.channels] }, 1),
      "22023",
    );
    await rejects(
      () =>
        save({ ...body, channels: [{ ...body.channels[0], visits: -1 }] }, 1),
      "22023",
    );
    await rejects(
      () =>
        save(
          { ...body, channels: [{ ...body.channels[0], conversions: 501 }] },
          1,
        ),
      "22023",
    );
    await rejects(() => db.query("select * from public.kpi_funnels"), "42501");
    await rejects(() => db.query("delete from public.kpi_funnels"), "42501");
    await as("client");
    assert((await read()).item === null, "unpublished leaked");
    await rejects(() => save(body, 1), "42501");
    await rejects(() => read(2), "42501");
    await as("ns");
    r = await save({ ...body, customer_visible: true }, 1);
    body = r.item.body;
    assert(r.canWrite && r.item.row_version === 2, "NS editor cannot save");
    await rejects(() => save(body, null, crypto.randomUUID(), 2), "42501");
    await as("client");
    r = await read();
    assert(
      !r.canWrite &&
        !r.internal &&
        !Object.hasOwn(r.item.body.channels[0], "cost"),
      "client leaked cost or write permission",
    );
    await db.exec(
      `reset role;update public.project_memberships set allowed_pages=array['tasks'] where user_id='${users.client}' and project_id=1;`,
    );
    await as("client");
    await rejects(() => read(), "42501");
    await db.exec(
      `reset role;update public.project_memberships set allowed_pages=array['performance'] where user_id='${users.client}' and project_id=1;update public.projects set client_view_enabled=false where id=1;`,
    );
    await as("client");
    await rejects(() => read(), "42501");
    await as("manager");
    await save({ ...body, channels: [] }, 2);
    await db.exec("reset role");
    const audit = (
      await db.query(
        "select * from private.kpi_funnel_audit where project_id=1 order by row_version",
      )
    ).rows;
    assert(
      audit.length === 3 &&
        audit[2].before_body.channels.length === 1 &&
        audit[2].after_body.channels.length === 0 &&
        audit[1].actor_id === users.ns,
      "audit lost before/after/actor",
    );
    await db.exec(
      "set role anon;select set_config('request.jwt.claim.sub','',false)",
    );
    await rejects(() => read(), "42501");
    console.log(
      JSON.stringify({
        kpiFunnelSecurity: "pass",
        optimisticConcurrency: "pass",
        customerCostProjection: "pass",
        immutableAudit: "pass",
      }),
    );
  } finally {
    await db.exec("reset role;rollback");
  }
}
