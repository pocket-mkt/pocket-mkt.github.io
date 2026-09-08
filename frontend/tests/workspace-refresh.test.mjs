import test from "node:test";
import assert from "node:assert/strict";
import { startWorkspaceRefresh, authorizationFingerprint } from "../src/workspaceRefresh.js";
test("authority fingerprint detects same-user role, grants and write permission changes",()=>{
  const a={actor:{id:'a',role:'ns'},projects:{a:{permissionCode:'EDIT',allowedPages:['tasks','daily']}}};
  assert.equal(authorizationFingerprint(a),authorizationFingerprint({...a,projects:{a:{...a.projects.a,allowedPages:['daily','tasks']}}}));
  assert.notEqual(authorizationFingerprint(a),authorizationFingerprint({...a,projects:{a:{...a.projects.a,permissionCode:'READ_ONLY'}}}));
  assert.notEqual(authorizationFingerprint(a),authorizationFingerprint({...a,actor:{id:'a',role:'client'}}));
});
test("refresh is visible-only, draft-safe, deduplicated and cleaned up",async()=>{
  const doc=new EventTarget(),win=new EventTarget();let time=0,calls=0,busy=false,release,timer,cleared=false;
  doc.visibilityState='visible';win.navigator={onLine:true};win.setInterval=fn=>{timer=fn;return 1;};win.clearInterval=()=>{cleared=true;};
  const stop=startWorkspaceRefresh({document:doc,window:win,now:()=>time,busy:()=>busy,refresh:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  time=60_000;doc.visibilityState='hidden';await timer();assert.equal(calls,0);
  doc.visibilityState='visible';busy=true;await timer();assert.equal(calls,0);
  busy=false;const pending=timer();win.dispatchEvent(new Event('focus'));assert.equal(calls,1);release();await pending;
  await timer();assert.equal(calls,1);stop();time+=60_000;await timer();assert.equal(calls,1);assert.equal(cleared,true);
});
