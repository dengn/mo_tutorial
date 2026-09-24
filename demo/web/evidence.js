import {CAPABILITIES,STEPS,getCapability} from './catalog.js';
import {$,h,api,shell,updateProgress,sqlBlock,wireCopy,metricTiles,animateMetrics,capHref,stepHref} from './common.js';

shell('evidence');
const state=await api('state').catch(()=>({completed:[],metrics:{},evidence:[],events:[]}));
updateProgress(state);
const params=new URLSearchParams(location.search);
let selected=params.get('step')||params.get('cap')||'all';

function filterProof(){
  if(selected==='all')return [...(state.evidence||[])].reverse();
  const cap=getCapability(selected);
  if(cap)return [...(state.evidence||[])].reverse().filter(item=>cap.steps.includes(item.step));
  return [...(state.evidence||[])].reverse().filter(item=>item.step===selected);
}
function render(){
  const proof=filterProof(), cap=getCapability(selected);
  $('#app').innerHTML=`<section class="page-intro"><div class="eyebrow">Evidence / SQL</div><h1>每个结论，都能看到查询。</h1><p>这里只展示本地服务真实运行后留下的 SQL、返回值和事件。能力页的示例 SQL 与演示页的预览会在执行后变成可核对记录。</p></section>
  <div class="evidence-layout"><nav class="evidence-menu" aria-label="筛选记录"><button data-filter="all" class="${selected==='all'?'active':''}">全部记录</button>${CAPABILITIES.map(item=>`<button data-filter="${item.id}" class="${selected===item.id?'active':''}">${h(item.title)}</button>`).join('')}</nav><section><div class="section-head"><div><div class="eyebrow">${selected==='all'?'All records':cap?h(cap.tag):'Selected step'}</div><h2>${selected==='all'?'本地执行记录':cap?h(cap.title):h(STEPS.find(s=>s.id===selected)?.title||'执行记录')}</h2></div><span class="micro">${proof.length} 条 SQL 记录</span></div>
  ${cap?`<div class="detail-result" style="margin-bottom:28px"><div class="kicker">当前实测指标</div><div style="height:17px"></div>${metricTiles(cap.evidence,state)}<div style="margin-top:17px"><a class="text-link" href="${capHref(cap.id)}">返回能力介绍 ↗</a></div></div>`:''}
  <div class="evidence-list">${proof.length?proof.map((item,index)=>`<article class="evidence-entry"><h3>${h(STEPS.find(s=>s.id===item.step)?.title||({query:'SQL 实验台',search:'全文与向量搜索',operate:'下单与分析'}[item.step]||item.step))}</h3><div class="meta">${h(item.step)} · 记录 ${proof.length-index}</div>${sqlBlock(item.sql,'本地执行的关键 SQL')}<div class="result-line">${h(item.result)}</div></article>`).join(''):`<div class="empty-state">尚无这项能力的运行记录。<br><a class="text-link" href="${stepHref(cap?.steps[0]||'start')}">打开逐步演示 →</a></div>`}</div>
  <div class="evidence-events"><div class="section-head"><div><div class="eyebrow">Event log</div><h2>操作时间线</h2></div></div>${[...(state.events||[])].reverse().slice(0,18).map(item=>`<div class="event-row"><time>${h(new Date(item.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><span><strong>${h(item.title)}</strong> · ${h(item.detail)}</span></div>`).join('')||'<div class="empty-state">暂无运行事件。</div>'}</div></section></div>`;
  wireCopy();
  animateMetrics($('#app'));
  document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{selected=btn.dataset.filter;history.replaceState(null,'',selected==='all'?'/evidence.html':`/evidence.html?cap=${selected}`);render();window.scrollTo({top:0,behavior:'smooth'});}));
}
render();
