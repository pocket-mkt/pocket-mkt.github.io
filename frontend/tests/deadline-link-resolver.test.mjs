import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeadlineLinkResolver} from '../src/deadlineLinkResolver.js';

test('completion links share project reads and bound concurrency', async()=>{
 const calls=[];let active=0;let peak=0;
 const resolve=createDeadlineLinkResolver(async id=>{
   calls.push(id);active++;peak=Math.max(peak,active);
   await new Promise(done=>setTimeout(done,5));active--;
   return [{id:1,completionUrl:'https://example.com/'+id},{id:2,completionUrl:''}];
 });
 const results=await Promise.all(Array.from({length:12},(_,i)=>resolve({projectId:Math.floor(i/2),id:i%2+1})));
 assert.equal(calls.length,6);assert.equal(peak,3);assert.equal(results[1],'');
 await assert.rejects(resolve({projectId:0,id:99}));assert.equal(calls.length,6);
});
test('failed project reads can retry without caching a missing link',async()=>{
 let calls=0;const resolve=createDeadlineLinkResolver(async()=>{if(++calls===1)throw Error('offline');return [{id:1,completionUrl:'https://example.com'}];});
 await assert.rejects(resolve({projectId:1,id:1}));
 assert.equal(await resolve({projectId:1,id:1}),'https://example.com');assert.equal(calls,2);
});
