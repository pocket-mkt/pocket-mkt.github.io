import test from 'node:test';
import assert from 'node:assert/strict';
import { createHubDataSource } from '../src/api/dataSource.js';
import { readApiConfig } from '../src/api/config.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(pending){
  let user={userId:'old'},logouts=0;
  const live={getSession:()=>({user}),tasks:()=>pending.promise,mutate:()=>pending.promise,logout:()=>{logouts++;user=null;},login:async()=>{user={userId:'new'};return {data:{user}};}};
  const source=createHubDataSource({config:readApiConfig({VITE_POCKET_API_URL:'https://example.invalid/api'}),live});
  return {source,get logouts(){return logouts;}};
}
for(const method of ['tasks','mutate'])test(`late ${method} unauthorized response cannot log out a new account`,async()=>{
  const pending=deferred(),f=fixture(pending);const old=f.source[method]({});const rejected=assert.rejects(old,{code:'aborted'});
  f.source.logout();await f.source.login({});pending.reject(Object.assign(Error('old session expired'),{code:'unauthorized'}));await rejected;
  assert.equal(f.logouts,1);assert.equal(f.source.getState().user.userId,'new');
});
test('late read success is rejected across a session change',async()=>{
  const pending=deferred(),f=fixture(pending);const old=f.source.tasks({});const rejected=assert.rejects(old,{code:'aborted'});
  f.source.logout();await f.source.login({});pending.resolve({data:{private:'old data'}});await rejected;
  assert.equal(f.source.getState().user.userId,'new');
});
