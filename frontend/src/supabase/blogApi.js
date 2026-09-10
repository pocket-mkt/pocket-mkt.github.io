import { HubApiError } from '../api/errors.js';
const columns='id,project_id,platform,title,url,keyword,published_on,monthly_volume,goal_rank,row_version,archived,created_at,updated_at';
const rankColumns='id,target_id,recorded_on,rank,state,row_version';
export function createBlogApi(client){
  const run=async query=>{const {data,error}=await query;if(error)throw new HubApiError(error.code==='23505'?'동일한 URL·키워드 또는 날짜가 이미 등록되어 있습니다.':error.code==='42501'?'블로그 현황 접근 권한이 없습니다.':'저장·조회에 실패했습니다. 입력을 유지한 상태로 다시 시도하세요.',{code:error.code==='42501'?'forbidden':error.code});return data;};
  return {
    async read({projectId,platform,from,to,page=0,signal}){
      const items=await run(client.from('blog_targets').select(columns).eq('project_id',projectId).eq('platform',platform).eq('archived',false).order('id',{ascending:false}).range(page*100,page*100+100).abortSignal(signal));
      const visible=items.slice(0,100),ids=visible.map(x=>x.id);let history=[];
      // At most 100 targets × 30 days; PostgREST page size is bounded to 1000.
      if(ids.length)for(let start=0;start<3000;start+=1000){const batch=await run(client.from('blog_rank_records').select(rankColumns).in('target_id',ids).gte('recorded_on',from).lte('recorded_on',to).order('id').range(start,start+999).abortSignal(signal));history.push(...batch);if(batch.length<1000)break;}
      return {ok:true,data:{items:visible,history,hasMore:items.length>100}};
    },
    async save({projectId,item,fields}){
      const allowed=Object.fromEntries(['title','url','keyword','published_on','monthly_volume','goal_rank','archived'].filter(k=>k in fields).map(k=>[k,fields[k]]));
      const query=item?client.from('blog_targets').update(allowed).eq('project_id',projectId).eq('id',item.id).eq('row_version',item.row_version):client.from('blog_targets').insert({...allowed,project_id:projectId,platform:fields.platform,id:fields.id});
      const result=await run(query.select(columns));if(!result.length)throw new HubApiError('다른 사용자가 수정했습니다. 화면을 새로고침한 뒤 다시 확인하세요.',{code:'conflict'});return {ok:true,data:result[0]};
    },
    async rank({targetId,record,fields}){
      const allowed={recorded_on:fields.recorded_on,state:fields.state,rank:fields.state==='RANKED'?Number(fields.rank):null};
      const query=record?client.from('blog_rank_records').update(allowed).eq('id',record.id).eq('target_id',targetId).eq('row_version',record.row_version):client.from('blog_rank_records').insert({...allowed,target_id:targetId});
      const result=await run(query.select(rankColumns));if(!result.length)throw new HubApiError('순위 기록이 변경되었습니다. 새로고침 후 다시 확인하세요.',{code:'conflict'});return {ok:true,data:result[0]};
    },
  };
}
