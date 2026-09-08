import test from 'node:test';
import assert from 'node:assert/strict';
import { rowWindow } from '../src/useWindowedRows.js';
test('variable-height windows preserve total scroll extent and overscan',()=>{
 const items=Array.from({length:1000},(_,id)=>({id}));const heights=new Map([['0',96]]);
 const range=rowWindow(items,heights,24000,600,48);
 assert.ok(range.end-range.start<35);assert.equal(range.before+(range.end-range.start)*48+range.after,48048);
 const last=rowWindow(items,heights,48000,600,48);assert.equal(last.end,1000);assert.equal(last.after,0);
});
test('off-screen focused editor remains mounted and empty filters remain valid',()=>{
 const items=Array.from({length:500},(_,id)=>({id}));
 assert.equal(rowWindow(items,new Map(),15000,600,48,'1').start,1);
 assert.deepEqual(rowWindow([],new Map(),300,600),{start:0,end:0,before:0,after:0});
});
