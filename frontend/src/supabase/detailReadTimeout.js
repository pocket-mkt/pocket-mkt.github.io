import { HubApiError } from '../api/errors.js';

export async function withDetailReadTimeout(operation, signal, milliseconds = 12000) {
  const controller = new AbortController();
  let timer, abort;
  try {
    const interrupted = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(new HubApiError('조회가 취소되었습니다.', {code:'aborted'})); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, {once:true});
      timer = setTimeout(() => { controller.abort(); reject(new HubApiError('상세 조회 시간이 초과되었습니다.', {code:'detail_timeout'})); }, milliseconds);
    });
    return await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw new HubApiError('조회 취소',{code:'aborted'});return operation(controller.signal);}), interrupted]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
