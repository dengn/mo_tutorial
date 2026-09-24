import {STEPS} from './catalog.js';

export const caseId = location.pathname.endsWith('/capability.html') ? (new URLSearchParams(location.search).get('id')||'git4data') : null;
const caseNames=['demo_shop_ci','demo_shop','demo_ingest','demo_pitr_shop','demo_story_lake','demo_price_history','demo_cdc_pitr','demo_load_catalog','demo_catalog','demo_partner','demo_supplier','demo_promo_base','demo_before_accident','demo_story_ice','demo_orders_cdc','demo_sink'];
export const caseSQL = value => caseId ? String(value).replace(new RegExp('\\b('+caseNames.join('|')+')\\b','g'),name=>'case_'+caseId+'_'+name.slice(5)) : String(value);

export const $ = (selector, root=document) => root.querySelector(selector);
export const h = (value='') => caseSQL(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const fmt = (value) => typeof value === 'number' ? new Intl.NumberFormat('zh-CN').format(value) : String(value ?? '—');
export const metric = (state, key) => state?.metrics?.[key];
export const done = (state, id) => (state?.completed || []).includes(id);
export const evidenceFor = (state, id) => [...(state?.evidence || [])].reverse().find(row => row.step === id);

export async function api(path, body) {
  let response;
  if(caseId && ['state','query','check','insight','vector-health','pitr','iceberg','case'].includes(path)){
    if(path==='state') path='case?feature='+encodeURIComponent(caseId);
    else {body={...body,operation:body?.action,action:path==='case'?body.action:path,case:caseId};path='case';}
  }
  try {response = await fetch('/api/' + path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});}
  catch {throw new Error('无法连接本地执行服务。请在教程仓库运行 ./demo/start.sh，然后访问 http://127.0.0.1:8042/');}
  let data;
  try { data = await response.json(); } catch { throw new Error('当前页面没有连接到演示 API。请从 http://127.0.0.1:8042/ 打开文档。'); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export function shell(page) {
  const links = [['home','功能','/'],['demo','场景演示','/demo.html'],['lab','SQL 控制台','/lab.html?tab=sql'],['evidence','执行记录','/evidence.html']];
  $('#site-header').innerHTML = `<header class="topbar"><a class="brand" href="/"><span class="brand-mark">M<span>O</span></span><span class="brand-name">MatrixOne <small>INTERACTIVE DOCS</small></span></a><nav aria-label="主导航">${links.map(([id,label,url])=>`<a href="${url}" class="${page===id?'active':''}">${label}</a>`).join('')}</nav><div class="header-status"><span class="status-dot"></span><span id="header-progress">本地演示</span></div></header>`;
  $('#site-footer').innerHTML = `<footer class="footer"><span>MatrixOne · v4.2.4 interactive docs</span><span>真实 SQL · 本地数据 · 可核对结果</span></footer>`;
}

export function updateProgress(state) {
  const el = $('#header-progress'); if (!el) return;
  el.textContent = state.case ? `本案例 ${state.case.completed.length} / ${state.case.steps.length} 步` : `${(state.completed||[]).length} / ${STEPS.length} 已执行`;
  $('.status-dot')?.classList.toggle('is-live', done(state,'start'));
}

export function toast(message, type='error') {
  let el=$('#toast'); if (!el) {el=document.createElement('div');el.id='toast';el.setAttribute('role','status');document.body.append(el);}
  el.className='toast '+type; el.textContent=message; clearTimeout(el.timer); el.timer=setTimeout(()=>el.classList.add('hidden'),6000);
}

export function sqlBlock(sql, label='SQL') {
  const keywords=/\b(SELECT|FROM|WHERE|CREATE|DATABASE|TABLE|SNAPSHOT|CLONE|RESTORE|INDEX|FULLTEXT|USING|ON|ORDER BY|GROUP BY|LIMIT|INSERT|INTO|UPDATE|SET|DELETE|DROP|AS|AND|OR|JOIN|UNION ALL|COUNT|SUM|MATCH|AGAINST|BEGIN|COMMIT|ROLLBACK|EXECUTE|TASK|PUBLICATION|CDC|PITR|SHOW)\b/gi;
  let last=0,marked='';
  for(const match of sql.matchAll(keywords)){marked+=h(sql.slice(last,match.index))+`<span class="sql-keyword">${h(match[0])}</span>`;last=match.index+match[0].length;}
  marked+=h(sql.slice(last));
  return `<div class="sql-card"><div class="sql-head"><span><i class="code-dot"></i>${h(label)}</span><button class="copy-btn" type="button">复制 SQL</button></div><pre><code>${marked}</code></pre></div>`;
}

export function wireCopy(root=document) {
  root.querySelectorAll('.copy-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
    try {await navigator.clipboard.writeText(btn.closest('.sql-card').querySelector('code').textContent); btn.textContent='已复制';setTimeout(()=>btn.textContent='复制 SQL',1800);} catch {toast('当前浏览器无法复制，请选中 SQL 手动复制');}
  }));
}

export function metricTiles(pairs, state) {
  return `<div class="metric-tiles">${pairs.map(([key,label,suffix=''])=>{const value=metric(state,key);return `<div class="metric-tile"><span>${h(label)}</span><strong>${value===undefined?'—':h(fmt(value))}${value===undefined?'':h(suffix)}</strong></div>`}).join('')}</div>`;
}

export function animateMetrics(root=document) {
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  root.querySelectorAll('.metric-tile').forEach((tile,index)=>{tile.style.animationDelay=`${Math.min(index,5)*75}ms`;tile.classList.add('metric-arrived');});
}

export function checkCell(check, ready=true) {
  const crossSource=['subscriber','cdc_sink'].includes(check.id),fixed=crossSource||check.fixed;
  return `<section class="db-console check-cell" data-check="${h(check.id)}" data-original-sql="${h(check.sql)}"><div class="db-console-top"><div class="db-console-title"><span class="console-window-dots"><i></i><i></i><i></i></span><strong>${h(check.label)}</strong></div><span class="db-connection"><i class="status-dot ${ready?'is-live':''}"></i>${crossSource?(check.id==='subscriber'?'订阅账号 · MatrixOne':'目标端 · MySQL'):'MatrixOne v4.2.4'}</span></div><div class="db-console-tabs"><span class="active">查询 1</span><span class="db-console-context">${crossSource?'指定账号 / 目标端查询':fixed?'固定 SQL · 实时执行':'只读 SQL · 可编辑'}</span></div><div class="db-editor"><div class="db-gutter" aria-hidden="true"></div><textarea class="db-sql-input" aria-label="${h(check.label)} SQL 编辑器" spellcheck="false" ${fixed?'readonly':''}>${h(check.sql)}</textarea></div><div class="db-console-toolbar"><button type="button" class="btn primary check-run" ${ready?'':'disabled'}>▶ 执行查询</button><span class="db-shortcut">${fixed?'执行本条 SQL':'Ctrl / ⌘ + Enter'}</span><span class="check-state">${ready?'就绪':'完成对应章节后可运行'}</span></div><div class="db-results"><div class="db-result-tabs"><span class="active">结果</span><span>消息</span></div><div class="check-result" aria-live="polite"><div class="db-empty">运行查询后，结果表格将在这里显示。</div></div></div><div class="db-console-foot"><span>LOCAL CONNECTION</span><span>最多显示 100 行</span></div></section>`;
}

export function resultTable(columns, rows) {
  if(!rows?.length)return '<div class="empty-state">查询已执行，返回 0 行。</div>';
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th class="row-number">#</th>${columns.map(column=>`<th>${h(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row,index)=>`<tr><td class="row-number">${index+1}</td>${row.map(value=>`<td>${h(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function planEvidence(checkId, rows){
  const node={vector_plan:'ivf_search',vector_plan_pre:'ivf_search',fulltext_plan:'fulltext_index_scan'}[checkId];
  if(!node)return '';
  const found=rows.flat().join('\n').includes(node);
  const stages=found?(checkId==='fulltext_plan'?['fulltext_index_scan','Join 商品表','SQL 结果']:['ivf_search','Join / 库存过滤','Top-K 结果']):['未在本次计划中看到 '+node];
  return `<div class="plan-evidence ${found?'found':'missing'}"><span>${found?'本次执行计划命中索引路径':'本次执行计划需检查'}</span><div>${stages.map((stage,index)=>`<b>${h(stage)}</b>${index<stages.length-1?'<i>→</i>':''}`).join('')}</div><small>依据下方本机 EXPLAIN 原始结果生成</small></div>`;
}

export function wireChecks(root=document) {
  root.querySelectorAll('.check-cell').forEach(cell=>{
    const editor=cell.querySelector('.db-sql-input');
    const updateLines=()=>{cell.querySelector('.db-gutter').innerHTML=Array.from({length:Math.max(1,editor.value.split('\n').length)},(_,index)=>`<span>${index+1}</span>`).join('');};
    editor.addEventListener('input',updateLines);editor.addEventListener('scroll',()=>{cell.querySelector('.db-gutter').scrollTop=editor.scrollTop;});updateLines();
    editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();cell.querySelector('.check-run')?.click();}});
    cell.querySelector('.check-run')?.addEventListener('click',async()=>{
      const button=cell.querySelector('.check-run'),status=cell.querySelector('.check-state'),output=cell.querySelector('.check-result');
      button.disabled=true;status.textContent='正在查询…';status.className='check-state running';
      try{
        const custom=!editor.readOnly&&editor.value.trim().replace(/;$/,'').trim()!==cell.dataset.originalSql.trim().replace(/;$/,'').trim();
        const started=performance.now();
        const data=custom?await api('query',{sql:editor.value}):await api('check',{check:cell.dataset.check});
        const duration=data.duration_ms??Math.round(performance.now()-started);
        const source=data.source==='mysql'?'MySQL 目标端':data.source==='subscriber'?'订阅账号':'MatrixOne v4.2.4';
        output.innerHTML=`<div class="check-result-meta"><span class="status-dot is-live"></span><strong>成功</strong><span>${h(source)}</span><span>${data.rows.length} 行</span><span>${duration} ms</span></div>${planEvidence(cell.dataset.check,data.rows)}${resultTable(data.columns,data.rows)}`;
        status.textContent='查询成功';status.className='check-state ok';button.textContent='▶ 再次执行';
      }catch(error){output.innerHTML=`<div class="check-error">${h(error.message)}</div>`;status.textContent='执行失败';status.className='check-state error';button.textContent='▶ 重试查询';}
      button.disabled=false;
    });
  });
}

export function stepHref(id) {return `/demo.html?step=${encodeURIComponent(id)}`;}
export function capHref(id) {return `/capability.html?id=${encodeURIComponent(id)}`;}
