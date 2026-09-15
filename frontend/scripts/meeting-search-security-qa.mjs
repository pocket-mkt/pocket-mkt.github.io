// Local PGlite only: exercise the unchanged production RLS for the new read path.
export async function verifyMeetingSearchSecurity(db, userIds, assert) {
  await db.exec(`reset role; begin;
    update public.projects set client_view_enabled=true where id=1;
    update public.project_memberships set allowed_pages=array['daily'],status_code='ACTIVE',archived_at=null where project_id=1 and user_id in ('${userIds.ns}','${userIds.client}');
    update public.project_memberships set archived_at=now() where project_id=2 and user_id='${userIds.ns}';
    insert into public.daily_meetings(project_id,meeting_date,title,discussion_text,visibility_code,legacy_id) values
    (1,'2020-01-01','SEO team','검색 최적화','PROJECT_TEAM','search-qa-team'),
    (1,'2020-01-01','SEO pocket','private','POCKET_ONLY','search-qa-pocket'),
    (1,'2020-01-01','SEO client','public','CLIENT','search-qa-client'),
    (2,'2020-01-01','SEO other','other','PROJECT_TEAM','search-qa-other');
    insert into public.daily_meetings(project_id,meeting_date,title,discussion_text,visibility_code,legacy_id,archived_at) values
    (1,'2020-01-01','SEO archived','archived','PROJECT_TEAM','search-qa-archived',now());
  `);
  const read = async user => {
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    return (await db.query("select title from public.daily_meetings where archived_at is null and project_id in (1,2) and (title ilike '%SEO%' or discussion_text ilike '%검색 최적화%') and legacy_id like 'search-qa-%' order by meeting_date desc,id desc limit 21")).rows.map(row=>row.title).sort();
  };
  try {
    assert(JSON.stringify(await read(userIds.manager))===JSON.stringify(['SEO client','SEO other','SEO pocket','SEO team']),'manager meeting search visibility');
    assert(JSON.stringify(await read(userIds.ns))===JSON.stringify(['SEO client','SEO team']),'NS search leaked pocket-only/cross-project/archived');
    assert(JSON.stringify(await read(userIds.client))===JSON.stringify(['SEO client']),'client search leaked internal meetings');
    await db.exec(`reset role;update public.project_memberships set allowed_pages=array['tasks'] where project_id=1 and user_id='${userIds.client}';`);
    assert((await read(userIds.client)).length===0,'missing daily grant leaked search');
    console.log('Meeting search: manager/NS/client visibility, project/page grants and archived exclusion passed');
  } finally { await db.exec('reset role; rollback;'); }
}
