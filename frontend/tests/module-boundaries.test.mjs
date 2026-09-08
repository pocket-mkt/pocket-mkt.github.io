import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {parse}=require('@babel/parser');const traverse=require('@babel/traverse').default;
for(const file of ['App.jsx','TaskWorkspace.jsx','PermissionsView.jsx','useActiveResource.js','useWindowedRows.js']) test(`${file}: extracted references resolve without an App import cycle`,()=>{
 const code=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 const allowed=new Set(['window','document','AbortController','ResizeObserver','requestAnimationFrame','cancelAnimationFrame']);
 const missing=new Set();
 traverse(parse(code,{sourceType:'module',plugins:['jsx']}),{ReferencedIdentifier(path){if(!path.scope.hasBinding(path.node.name)&&!allowed.has(path.node.name))missing.add(path.node.name);}});
 assert.deepEqual([...missing],[]);
 if(file!=='App.jsx')assert.doesNotMatch(code,/from ["']\.\/App\.jsx/);
});
