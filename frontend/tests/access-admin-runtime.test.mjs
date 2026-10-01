import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
const source=readFileSync(new URL('../../supabase/functions/access-admin/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const {code}=await transform(source,{loader:'ts',target:'es2022'});
function fixture({ns=false,numeric=false,internalTarget=false}={}) {
  let handler,authWrites=0;
  const actor={id:'actor',organization_code:ns?'NS':'POCKET',role_code:ns?'EXECUTOR_EDITOR':'POCKET_MANAGER',status_code:'ACTIVE',archived_at:null};
  const target={id:'target',organization_code:internalTarget?'POCKET':'CLIENT',role_code:internalTarget?'POCKET_MANAGER':'CLIENT_VIEWER',status_code:'ACTIVE',archived_at:null,display_name:'QA 고객'};
  const users=[{id:'target',email:'qa@hub.local',user_metadata:{}}];
  const tables={profiles:[actor,target],clients:[{id:5,legacy_id:'CLT-QA',display_name:'QA 고객사',archived_at:null}],projects:[{id:5,legacy_id:numeric?null:'PRJ-QA',client_id:5,project_name:'온라인 캠페인',status_code:'ACTIVE',archived_at:null}],project_memberships:[{id:17,user_id:'target',project_id:5,permission_code:'READ_ONLY',allowed_pages:['progress','reports'],status_code:'ACTIVE',row_version:3,archived_at:null},{id:18,user_id:'actor',project_id:5,permission_code:'EDIT',status_code:'ACTIVE',archived_at:null}]};
  const from=table=>{
    const filters=[];let operation='read',values,single=false,limit=Infinity;
    const execute=async()=>{
      let rows=tables[table].filter(row=>filters.every(test=>test(row))).slice(0,limit);
      if(operation==='update')rows.forEach(row=>Object.assign(row,values,{row_version:(row.row_version||0)+1}));
      if(operation==='insert'){const row={id:100+tables[table].length,row_version:1,archived_at:null,...values};tables[table].push(row);rows=[row];}
      if(operation==='upsert'){let row=tables[table].find(r=>r.id===values.id);if(row)Object.assign(row,values);else {row={...values};tables[table].push(row);}rows=[row];}
      return {data:single?(rows[0]||null):rows,error:null};
    };
    const q={select:()=>q,order:()=>q,eq:(key,value)=>{filters.push(row=>String(row[key])===String(value));return q;},is:(key,value)=>{filters.push(row=>(row[key]??null)===value);return q;},in:(key,values)=>{filters.push(row=>values.map(String).includes(String(row[key])));return q;},limit:n=>{limit=n;return q;},update:v=>{operation='update';values=v;return q;},insert:v=>{operation='insert';values=v;return q;},upsert:v=>{operation='upsert';values=v;return q;},maybeSingle:()=>{single=true;return execute();},then:(yes,no)=>execute().then(yes,no)};return q;
  };
  const admin={from,auth:{admin:{listUsers:async()=>({data:{users},error:null}),createUser:async attrs=>{authWrites++;const user={id:'created',...attrs};users.push(user);return {data:{user},error:null};},updateUserById:async(id,attrs)=>{authWrites++;return {data:{user:{...users.find(u=>u.id===id),...attrs}},error:null};}}}};
  vm.runInNewContext(code,{Deno:{env:{get:key=>({SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-only'}[key])},serve:fn=>{handler=fn;}},createClient:(_,key)=>key==='server-only'?admin:{auth:{getUser:async token=>({data:{user:token==='valid'?{id:'actor'}:null},error:null})}},Request,Response,Headers,console:{error:()=>{}},Set,Map});
  return {tables,writes:()=>authWrites,call:async(body,token='valid')=>{const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}};
}
const change=(fields={})=>({operation:'UPSERT',account:{account:'qa',displayName:'QA 고객',projectId:'PRJ-QA',enabled:true,allowedPages:['reports'],membershipId:'17',expectedRowVersion:3,...fields}});
test('실제 계정관리 handler는 보고서 단독 권한과 고객사·프로젝트 라벨을 저장·반환한다',async()=>{
  const f=fixture();const saved=await f.call(change());assert.equal(saved.status,200);assert.deepEqual(Array.from(f.tables.project_memberships[0].allowed_pages),['reports']);
  const result=await f.call({operation:'READ'});assert.equal(result.data.data.projects[0].client_name,'QA 고객사');assert.equal(result.data.data.accounts[0].accesses[0].client_name,'QA 고객사');
  assert.ok(result.data.data.pageOptions.includes('reports'));
});
test('legacy ID가 없는 신규 프로젝트도 표시된 숫자 ID로 배정한다',async()=>{
  const f=fixture({numeric:true});assert.equal((await f.call(change({projectId:'5'}))).status,200);
});
test('다른 프로젝트 멤버십·오래된 버전은 인증정보를 바꾸기 전에 거절한다',async()=>{
  for(const fields of [{membershipId:'other'},{expectedRowVersion:1}]){const f=fixture();assert.equal((await f.call(change(fields))).status,409);assert.equal(f.writes(),0);}
});
test('고객계정 폼으로 내부 운영자 계정을 덮어쓸 수 없다',async()=>{
  const f=fixture({internalTarget:true});assert.equal((await f.call(change())).status,403);assert.equal(f.writes(),0);assert.equal(f.tables.profiles[1].role_code,'POCKET_MANAGER');
});
test('NS의 프로젝트 권한 편집은 허용하되 UPSERT를 통한 전체계정 중지는 차단한다',async()=>{
  const f=fixture({ns:true});assert.equal((await f.call(change({enabled:false}))).status,403);assert.equal(f.writes(),0);assert.equal((await f.call(change())).status,200);
});
test('NS 배정 밖·미인증 접근은 서버에서 거절한다',async()=>{
  const f=fixture({ns:true});f.tables.project_memberships=f.tables.project_memberships.filter(m=>m.user_id!=='actor');assert.equal((await f.call(change())).status,403);assert.equal((await f.call(change(),'invalid')).status,401);assert.equal(f.writes(),0);
});
test('NS는 담당 프로젝트에 보고서 전용 고객 계정을 생성할 수 있다',async()=>{
  const f=fixture({ns:true});const result=await f.call(change({account:'new-client',accessCode:'qa-password-123',membershipId:undefined,expectedRowVersion:undefined}));
  assert.equal(result.status,200);assert.equal(f.writes(),1);
  const profile=f.tables.profiles.find(p=>p.id==='created');assert.equal(profile.organization_code,'CLIENT');assert.equal(profile.role_code,'CLIENT_VIEWER');
  const membership=f.tables.project_memberships.find(m=>m.user_id==='created');assert.equal(membership.project_id,5);assert.deepEqual(Array.from(membership.allowed_pages),['reports']);
});
