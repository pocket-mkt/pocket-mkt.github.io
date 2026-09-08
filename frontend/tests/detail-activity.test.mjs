import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetailActivityReader } from '../src/supabase/detailActivityRead.js';
function fixture(error=null) {
 const calls=[];
 const client={from(table){const q={then(resolve){return Promise.resolve({data:table==='profiles'?[]:[{id:2,created_at:'2026-09-08T00:00:00Z'},{id:1,created_at:'2026-09-07T00:00:00Z'}],error}).then(resolve);}};for(const key of ['select','order','limit','eq','is','or','abortSignal'])q[key]=(...args)=>{calls.push([table,key,...args]);return q;};return q;}};
 return {read:createDetailActivityReader(client),calls};
}
test('세부로그는 안전한 허용 컬럼만 조회하고 계정별 필터와 서버 페이지 경계를 적용한다',async()=>{
 const f=fixture();const actorId='12345678-1234-1234-1234-123456789abc';
 const result=await f.read({actorId,limit:1});
 assert.equal(result.data.items.length,1);assert.equal(result.data.nextCursor.id,'2');
 assert.ok(f.calls.some(c=>c[1]==='eq'&&c[2]==='actor_user_id'&&c[3]===actorId));
 assert.doesNotMatch(f.calls.filter(c=>c[1]==='select').map(c=>c[2]).join(','),/\*|before_data|after_data|email|password/);
 await assert.rejects(f.read({actorId:'bad'}),{code:'invalid_filter'});
 await assert.rejects(f.read({cursor:{id:'1),x',createdAt:'2026-09-08'}}),{code:'invalid_cursor'});
});
test('권한 오류는 빈 목록으로 위장하거나 Sheets로 우회하지 않는다',async()=>{
 await assert.rejects(fixture({code:'42501'}).read(),{code:'forbidden'});
 const f=fixture();await f.read({actorId:'system'});assert.ok(f.calls.some(c=>c[1]==='is'&&c[2]==='actor_user_id'));
});
