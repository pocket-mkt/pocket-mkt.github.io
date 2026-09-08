import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { isNewTask } from './taskFreshness.js';

export default function WorkspaceNotifications({source,actorId,onSelect}) {
  const [open,setOpen]=useState(false);
  const [state,setState]=useState({items:[],loading:true,error:'',cursor:null});
  const [read,setRead]=useState(()=>{try{const saved=JSON.parse(sessionStorage.getItem('mh:workspace-alert:'+actorId)||'[]');return Array.isArray(saved)?saved:[];}catch{return [];}});
  const root=useRef(null),controller=useRef(null),pending=useRef(false);
  const load=async(cursor=null)=>{
    if(pending.current)return;
    pending.current=true;
    const request=new AbortController();controller.current=request;
    setState(old=>({...old,loading:true,error:''}));
    try {
      const result=await source.activity({workspaceNotifications:true,cursor,limit:100,signal:request.signal});
      if(request.signal.aborted)return;
      const items=(result.data.items||[]).filter(item=>isNewTask({createdAt:item.created_at}));
      setState(old=>({items:cursor?[...new Map([...old.items,...items].map(item=>[item.id,item])).values()]:items,loading:false,error:'',cursor:result.data.nextCursor}));
    }catch{if(!request.signal.aborted)setState({items:[],loading:false,error:'전체 알림을 불러오지 못했습니다. 다시 시도해 주세요.',cursor:null});}
    finally{pending.current=false;}
  };
  useEffect(()=>{
    void load();
    const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!root.current?.querySelector('[role="dialog"]'))void load();},60000);
    return ()=>{clearInterval(timer);controller.current?.abort();};
  },[source,actorId]);
  useEffect(()=>{
    if(!open)return;
    const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};
    const escape=event=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};
  },[open]);
  const acknowledge=ids=>{
    const next=[...new Set([...(Array.isArray(read)?read:[]),...ids.map(String)])].slice(-2000);setRead(next);
    try{sessionStorage.setItem('mh:workspace-alert:'+actorId,JSON.stringify(next));}catch{}
  };
  const items=state.items.filter(item=>isNewTask({createdAt:item.created_at}));
  const unread=items.filter(item=>!read.includes(String(item.id)));
  return <div className="notification-center" ref={root}><button type="button" className="notification-trigger" aria-label={'전체 프로젝트 알림, 미확인 '+unread.length+'건'+(state.cursor?' 이상':'')} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(value=>!value)}><Bell size={17}/>{unread.length>0&&<span className="notification-count">{unread.length}{state.cursor?'+':''}</span>}</button>{open&&<section className="notification-popover" role="dialog" aria-label="전체 프로젝트 알림"><header><div><strong>전체 프로젝트 알림</strong><span>최근 24시간 신규 업무 · 조회 권한 내 전체 프로젝트</span></div>{unread.length>0&&<button onClick={()=>acknowledge(items.map(item=>item.id))}>표시된 알림 확인</button>}</header><div className="notification-list">{state.error?<div className="notification-empty" role="alert"><span>{state.error}</span><button onClick={()=>void load()}>다시 시도</button></div>:items.map(item=><button className={'notification-item'+(!read.includes(String(item.id))?' is-unread':'')} key={item.id} onClick={()=>{acknowledge([item.id]);setOpen(false);onSelect({id:item.entity_id,projectId:String(item.project_id),title:item.task_detail?.task_title||''});}}><span className="notification-item-mark"/><span><small>{item.project?.project_name||'프로젝트'}</small><strong>{item.task_detail?.task_title||'새 업무 #'+item.entity_id}</strong><small>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created_at))} 등록</small></span></button>)}{state.loading&&<div className="notification-empty" role="status">알림을 불러오는 중입니다.</div>}{!state.loading&&!state.error&&!items.length&&<div className="notification-empty">최근 24시간 신규 업무 알림이 없습니다.</div>}{state.cursor&&<button disabled={state.loading} onClick={()=>void load(state.cursor)}>알림 더 보기</button>}</div><footer>확인 상태는 이 계정의 현재 브라우저 탭에만 저장됩니다.</footer></section>}</div>;
}
