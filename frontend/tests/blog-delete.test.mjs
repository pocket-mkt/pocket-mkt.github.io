import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlogApi} from '../src/supabase/blogApi.js';

function client(result){
 const calls=[];
 const query={then(resolve){return Promise.resolve(result).then(resolve);}};
 for(const name of ['update','eq','select'])query[name]=(...args)=>{calls.push([name,...args]);return query;};
 return {calls,from(table){calls.push(['from',table]);return query;}};
}
test('blog deletion archives only the selected project/id/version, without hard deleting history',async()=>{
 const c=client({data:[{id:'target',archived:true,row_version:5}],error:null});
 const result=await createBlogApi(c).save({projectId:3,item:{id:'target',row_version:4},fields:{archived:true}});
 assert.deepEqual(c.calls.slice(0,5),[['from','blog_targets'],['update',{archived:true}],['eq','project_id',3],['eq','id','target'],['eq','row_version',4]]);
 assert.equal(result.data.archived,true);
});
test('concurrent changes reject archive instead of reporting false success',async()=>{
 await assert.rejects(createBlogApi(client({data:[],error:null})).save({projectId:3,item:{id:'target',row_version:4},fields:{archived:true}}),{code:'conflict'});
});
test('forbidden archive reports error',async()=>{
 await assert.rejects(createBlogApi(client({data:null,error:{code:'42501'}})).save({projectId:3,item:{id:'target',row_version:4},fields:{archived:true}}),{code:'forbidden'});
});
