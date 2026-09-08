import { Component } from 'react';
import './screenBoundary.css';

export function isScreenLoadError(error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Unable to preload CSS|error loading dynamically imported module/i.test(String(error?.message || error || ''));
}

export default class ScreenBoundary extends Component {
  state = { failed:false, loadError:false };
  static getDerivedStateFromError(error) { return {failed:true,loadError:isScreenLoadError(error)}; }
  componentDidCatch() {
    // Never log a render error payload: credential screens may contain secrets.
  }
  render() {
    if(!this.state.failed) return this.props.children;
    return <section className="screen-recovery" role="alert"><h2>{this.state.loadError ? '새 화면 파일을 불러오지 못했습니다' : '이 화면을 표시하는 중 문제가 발생했습니다'}</h2><p>{this.state.loadError ? '배포로 화면이 업데이트됐거나 네트워크 연결이 끊겼을 수 있습니다. 새로고침하면 최신 화면을 불러옵니다.' : '다른 메뉴로 이동하거나 화면을 다시 열어 주세요. 문제가 반복되면 새로고침해 주세요.'}</p><small>저장된 데이터는 삭제되지 않습니다. 새로고침하면 저장하지 않은 입력은 사라질 수 있습니다.</small><div>{!this.state.loadError && <button type="button" onClick={()=>this.setState({failed:false,loadError:false})}>화면 다시 시도</button>}<button type="button" onClick={()=>{if(window.confirm('저장하지 않은 입력은 사라질 수 있습니다. 최신 화면을 다시 불러올까요?')) window.location.reload();}}>최신 화면 새로고침</button></div><span>오류 구분: {this.state.loadError ? 'SCREEN_LOAD_FAILED' : 'SCREEN_RENDER_FAILED'}</span></section>;
  }
}
