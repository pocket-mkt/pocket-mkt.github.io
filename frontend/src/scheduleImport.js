import { normalizeScheduleDates, serializeScheduleDates } from './taskGantt.js';

export const MAX_SCHEDULE_BYTES = 10 * 1024 * 1024;
export const MAX_SCHEDULE_ROWS = 1000;
export const IMPORT_STATUS_OPTIONS = [['NOT_STARTED','시작 전'],['IN_PROGRESS','진행중'],['DELAYED','지연'],['DONE','완료'],['ON_HOLD','보류']];
const STATUS = { '예정':'NOT_STARTED','미착수':'NOT_STARTED','시작전':'NOT_STARTED','진행중':'IN_PROGRESS','지연':'DELAYED','완료':'DONE','보류':'ON_HOLD', COMPLETED:'DONE', ...Object.fromEntries(IMPORT_STATUS_OPTIONS.map(([code])=>[code,code])) };
const OWNER = { '포켓':'POCKET','포켓컴퍼니':'POCKET', POCKET:'POCKET', NS:'NS','NS마케팅':'NS', '고객':'CLIENT','고객사':'CLIENT', CLIENT:'CLIENT' };
const MEDIA = { '홈페이지':'WEBSITE', WEBSITE:'WEBSITE', '자사몰':'WEBSITE', YOUTUBE:'YOUTUBE','유튜브':'YOUTUBE', INSTAGRAM:'INSTAGRAM','인스타':'INSTAGRAM','인스타그램':'INSTAGRAM', NAVER:'NAVER','네이버':'NAVER','네이버블로그':'NAVER_BLOG', NAVERBLOG:'NAVER_BLOG', NAVER_BLOG:'NAVER_BLOG', '네이버플레이스':'NAVER_SMARTPLACE','플레이스':'NAVER_SMARTPLACE', TIKTOK:'TIKTOK','틱톡':'TIKTOK', ADS:'ADS','광고':'ADS','구글':'GOOGLE_SEARCH',GOOGLE:'GOOGLE_SEARCH' };
const compact = value => String(value || '').replace(/\s/g,'').toUpperCase();
const text = (value, limit, label) => {
  if (value != null && typeof value !== 'string') throw Error(`${label} 형식을 확인해 주세요.`);
  const result = (value || '').trim();
  if (result.length > limit || result.includes('\0')) throw Error(`${label}은 ${limit}자 이내여야 합니다.`);
  return result;
};
function date(value, label, optional = false) {
  if (!value && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error(`${label} 날짜 형식이 올바르지 않습니다.`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value || value < '2000-01-01' || value > '2100-12-31') throw Error(`${label} 날짜를 확인해 주세요.`);
  return value;
}
function addDays(start, offset) { return new Date(Date.parse(`${start}T00:00:00Z`) + offset*86400000).toISOString().slice(0,10); }
function attribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`,'i').exec(attributes)?.slice(1).find(value=>value!==undefined);
}

// Read only the exported JSON seed. Never load the HTML in a DOM or execute scripts.
export function parseScheduleHtml(html) {
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > MAX_SCHEDULE_BYTES) throw Error('10MB 이하의 일정 HTML 파일을 선택해 주세요.');
  const seeds = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match=>attribute(match[1],'id')==='seed' && attribute(match[1],'type')?.toLowerCase()==='application/json');
  if (seeds.length !== 1) throw Error('일정 데이터를 찾지 못했습니다. 포켓 일정 보드에서 저장한 HTML 파일을 선택해 주세요.');
  let data; try { data=JSON.parse(seeds[0][2]); } catch { throw Error('파일의 일정 데이터가 손상되었습니다. 다시 저장한 HTML을 선택해 주세요.'); }
  if (!Array.isArray(data?.campaigns) || !data.campaigns.length || data.campaigns.length > 50) throw Error('파일에 가져올 캠페인이 없습니다.');
  let total=0;
  const campaigns=data.campaigns.map((campaign,campaignIndex)=>{
    const name=text(campaign?.name,200,'캠페인명') || `캠페인 ${campaignIndex+1}`;
    const start=date(campaign?.start,`${name} 시작일`), end=date(campaign?.end,`${name} 종료일`);
    if(end<start)throw Error(`${name} 종료일이 시작일보다 빠릅니다.`);
    if(!Array.isArray(campaign.rows))throw Error(`${name}의 업무 목록 형식이 올바르지 않습니다.`);
    total+=campaign.rows.length;if(total>MAX_SCHEDULE_ROWS)throw Error(`한 파일에서 최대 ${MAX_SCHEDULE_ROWS}개 업무를 가져올 수 있습니다.`);
    const ids=new Set();
    const rows=campaign.rows.map((row,index)=>{
      try {
        if(!row || typeof row!=='object' || Array.isArray(row))throw Error('업무 데이터 형식을 확인해 주세요.');
        const title=text(row.task,500,'업무명');if(!title)throw Error('업무명이 비어 있습니다.');
        const sourceId=text(row.id,200,'업무 ID');if(sourceId && ids.has(sourceId))throw Error('업무 ID가 중복되어 있습니다.');if(sourceId)ids.add(sourceId);
        const media=text(row.media,100,'매체'), mediaKey=compact(media);
        const categoryCode=MEDIA[mediaKey] || (/^[A-Z][A-Z0-9_]{0,49}$/.test(mediaKey)?mediaKey:null);
        if(media && !categoryCode)throw Error(`매체 “${media}”를 인식하지 못했습니다.`);
        const status=STATUS[compact(row.status || '예정')];if(!status)throw Error('상태를 인식하지 못했습니다.');
        const owner=OWNER[compact(row.owner)];if(!owner)throw Error('담당을 포켓·NS·고객사 중 하나로 지정해 주세요.');
        const originalStart=date(row.start,'업무 시작일',true), originalEnd=date(row.end,'업무 종료일',true);
        let dates;
        if(Object.hasOwn(row,'days')){
          if(!Array.isArray(row.days)||row.days.length>3660||row.days.some(day=>!Number.isInteger(day)||Math.abs(day)>3660))throw Error('선택된 일정 날짜가 올바르지 않습니다.');
          dates=[...new Set(row.days)].sort((a,b)=>a-b).map(offset=>date(addDays(start,offset),'선택 일정'));
        } else {
          if(Boolean(originalStart)!==Boolean(originalEnd)||originalEnd<originalStart)throw Error('시작일과 종료일을 확인해 주세요.');
          const count=originalStart?(Date.parse(originalEnd)-Date.parse(originalStart))/86400000+1:0;
          if(count>3660)throw Error('업무 기간이 너무 깁니다.');
          dates=Array.from({length:count},(_,day)=>addDays(originalStart,day));
        }
        const link=text(row.link,2048,'완료 링크');
        if(link){let url;try{url=new URL(link);}catch{throw Error('완료 링크 주소가 올바르지 않습니다.');}if(url.protocol!=='https:')throw Error('완료 링크는 https:// 주소여야 합니다.');}
        const fields={title,description:text(row.detail,20000,'세부내용'),category_code:categoryCode||'',phase_code:'M1',workstream_code:/썸네일|디자인|배너\s*제작/.test(title)?'DESIGN':/촬영|영상\s*편집/.test(title)?'VIDEO':'MARKETING',responsible_org_code:owner,reviewer_org_code:'POCKET',priority_code:'NORMAL',status_code:status,progress_percent:status==='DONE'?100:0,planned_start_date:dates[0]||null,due_date:dates.at(-1)||null,schedule_dates_json:serializeScheduleDates(dates),completion_url:link,remarks:text(row.note,9500,'비고')};
        return {index,sourceId,parentId:text(row.parentId,200,'상위 업무 ID'),media,dates,fields,dateAdjusted:(originalStart||null)!==fields.planned_start_date||(originalEnd||null)!==fields.due_date};
      }catch(error){throw Error(`${name} ${index+1}행: ${error.message}`);}
    });
    const parents=new Map(rows.filter(row=>row.sourceId).map(row=>[row.sourceId,row.fields.title]));
    for(const row of rows){
      row.parentTitle=parents.get(row.parentId)||'';
      if(row.parentId && !row.parentTitle)throw Error(`${name} ${row.index+1}행의 상위 업무를 찾지 못했습니다.`);
      if(row.parentId && row.parentId===row.sourceId)throw Error(`${name} ${row.index+1}행이 자기 자신을 상위 업무로 지정했습니다.`);
      if(row.parentTitle)row.fields.remarks=text([row.fields.remarks,`원본 상위 업무: ${row.parentTitle}`].filter(Boolean).join('\n'),10000,'비고');
    }
    return {name,start,end,month:start.slice(0,7),rows};
  });
  if(!total)throw Error('파일에 등록할 업무가 없습니다.');
  return {campaigns,total};
}

export async function readScheduleFile(file) {
  if(!file || !/\.html?$/i.test(file.name))throw Error('일정 HTML 파일(.html 또는 .htm)을 선택해 주세요.');
  if(!file.size || file.size>MAX_SCHEDULE_BYTES)throw Error('10MB 이하의 일정 HTML 파일을 선택해 주세요.');
  let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('UTF-8로 저장한 HTML 파일을 선택해 주세요.');}
  return {...parseScheduleHtml(html),fileName:file.name};
}

export function matchScheduleProject(campaign, projects, currentProjectId) {
  const name=compact(campaign.name);
  const matches=projects.filter(project=>compact(project.clientName)===name || compact(project.name)===name);
  return String(matches.length===1?matches[0].id:currentProjectId||projects[0]?.id||'');
}
async function sourceIdentity(campaign,row,month) {
  const identity=JSON.stringify([compact(campaign.name),month,row.sourceId||[row.index,row.fields.title]]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  return 'schedule-html:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function fingerprint(fields) {
  return JSON.stringify([fields.title,fields.description||'',fields.category_code||'',fields.responsible_org_code,fields.execution_month,normalizeScheduleDates(fields.schedule_dates_json)||[],fields.remarks||'']);
}
export async function prepareScheduleRows(campaign,month,existingTasks=[]) {
  date(`${month}-01`,'진행 월');
  const imported=new Set(existingTasks.map(task=>task.sourceTaskId).filter(Boolean));
  const fingerprints=new Set(existingTasks.map(task=>fingerprint({title:task.title,description:task.description,category_code:task.categoryCode,responsible_org_code:task.responsibleOrgCode,execution_month:task.executionMonth,schedule_dates_json:task.scheduleDates,remarks:task.remarks})));
  return Promise.all(campaign.rows.map(async row=>{
    const sourceId=await sourceIdentity(campaign,row,month);
    const fields={...row.fields,execution_month:`${month}-01`,source_task_id:sourceId};
    return {...row,fields,duplicate:imported.has(sourceId)?'이미 불러온 업무':fingerprints.has(fingerprint(fields))?'동일한 업무가 있음':''};
  }));
}
export function createScheduleImportPlan({projectId,month,rows,visibility='PROJECT_TEAM',lastOrder=0},makeId=()=>crypto.randomUUID()) {
  if(!projectId||!rows.length||rows.length>MAX_SCHEDULE_ROWS)throw Error('등록할 프로젝트와 업무를 선택해 주세요.');
  date(`${month}-01`,'진행 월');
  if(!['PROJECT_TEAM','CLIENT'].includes(visibility))throw Error('공개 범위를 확인해 주세요.');
  const order=Number(lastOrder)||0;if(!Number.isSafeInteger(order)||order+rows.length*10>2147483647)throw Error('업무 정렬 범위를 확인해 주세요.');
  return {projectId:String(projectId),month,offset:0,attempted:false,mutations:rows.filter(row=>!row.duplicate).map((row,index)=>({mutationId:makeId(),entityType:'task',operation:'CREATE',fields:{...row.fields,progress_percent:row.fields.status_code==='DONE'?100:0,execution_month:`${month}-01`,visibility_code:visibility,sort_order:order+(index+1)*10}}))};
}
export async function runScheduleImportPlan(plan,save,onProgress=()=>{}) {
  if(!plan.mutations.length)throw Error('새로 등록할 업무가 없습니다.');
  onProgress(plan.offset,plan.mutations.length);
  while(plan.offset<plan.mutations.length){
    const chunk=plan.mutations.slice(plan.offset,plan.offset+40);plan.attempted=true;
    await save(chunk);plan.offset+=chunk.length;onProgress(plan.offset,plan.mutations.length);
  }
  return {count:plan.offset};
}
