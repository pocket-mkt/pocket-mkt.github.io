import test from 'node:test';
import assert from 'node:assert/strict';
import {withDetailReadTimeout} from '../src/supabase/detailReadTimeout.js';
test('hung detail reads terminate and abort instead of leaving a loading button',async()=>{
 let signal;await assert.rejects(withDetailReadTimeout(next=>{signal=next;return new Promise(()=>{});},null,10),{code:'detail_timeout'});assert.equal(signal.aborted,true);
});
test('cancelled detail reads never start and successful reads return normally',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(withDetailReadTimeout(()=>{calls++;},controller.signal,10),{code:'aborted'});assert.equal(calls,0);
 assert.equal(await withDetailReadTimeout(async()=>42,null,50),42);
});
