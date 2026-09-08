import { HubApiError } from '../api/errors.js';

export function createDetailActivityReader(client) {
  return async ({ actorId = '', cursor, signal, limit = 100 } = {}) => {
    if (actorId && actorId !== 'system' && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new HubApiError('계정 필터가 올바르지 않습니다.', {code:'invalid_filter'});
    if (cursor && (!/^\d+$/.test(String(cursor.id)) || !Number.isFinite(Date.parse(cursor.createdAt)))) throw new HubApiError('조회 위치가 올바르지 않습니다.', {code:'invalid_cursor'});
    const count = Math.max(1, Math.min(100, Number(limit) || 100));
    // Explicit browser-granted metadata only. Never select before_data/after_data.
    let query = client.from('activity_events').select('id,project_id,entity_type,entity_id,action_code,actor_user_id,actor_role_code,event_status_code,created_at,project:projects!activity_events_project_id_fkey(project_name)')
      .order('created_at', {ascending:false}).order('id', {ascending:false}).limit(count + 1);
    if (actorId === 'system') query = query.is('actor_user_id', null);
    else if (actorId) query = query.eq('actor_user_id', actorId);
    if (cursor) query = query.or(`created_at.lt.${new Date(cursor.createdAt).toISOString()},and(created_at.eq.${new Date(cursor.createdAt).toISOString()},id.lt.${cursor.id})`);
    let accounts = client.from('profiles').select('id,display_name,organization_code').order('display_name');
    if (signal) { query = query.abortSignal(signal); accounts = accounts.abortSignal(signal); }
    const [events, profiles] = await Promise.all([query, accounts]);
    const error = events.error || profiles.error;
    if (error) throw new HubApiError('세부로그를 불러오지 못했습니다. 연결 상태와 조회 권한을 확인해 주세요.', {code:error.code === '42501' ? 'forbidden' : 'detail_log_unavailable', cause:error});
    const items = events.data.slice(0,count);
    const last = items.at(-1);
    return {ok:true,data:{items,actors:profiles.data,nextCursor:events.data.length>count ? {id:String(last.id),createdAt:last.created_at} : null}};
  };
}
