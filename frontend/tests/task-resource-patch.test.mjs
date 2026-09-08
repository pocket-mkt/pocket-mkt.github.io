import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTaskChanges, restoreTaskChanges } from '../src/taskResourcePatch.js';
for (const count of [100,500,1000]) test(`single-pass ${count}-row batch preserves identity, totals and rollback order`,()=>{
  const items=Array.from({length:count},(_,id)=>({id,title:`task ${id}`}));
  const state={resource:'tasks',projectId:'p',data:{items,total:count}};
  let visits=0;
  const changes=new Map(Array.from({length:40},(_,id)=>[id,item=>{visits++;return id%2?{...item,title:'changed'}:null;}]));
  const next=applyTaskChanges(state,'p',changes);assert.equal(visits,40);assert.equal(next.data.total,count-20);assert.equal(next.data.items.at(-1),items.at(-1));
  assert.deepEqual(restoreTaskChanges(next,'p',items,new Set(changes.keys())),state);
  assert.equal(applyTaskChanges(state,'other',changes),state);
});
