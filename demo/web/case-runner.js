import {h,api,sqlBlock,resultTable,wireCopy} from './common.js';
import {STEPS} from './catalog.js';
const preview={
 seed:"-- 创建本案例专属商品与订单表，插入六件商品。\n-- Git for Data：生成 1,000,000 行订单；其他业务案例：1,000 行。\n-- 检索案例：六条四维向量、JSON 属性与一份真实 DOCX。\n-- 完整 SQL 和每条返回值将在执行记录中展示。",
 health:"CREATE INDEX idx_embedding_ivf USING IVFFLAT ON demo_shop_ci.ivf_health_docs(embedding) LISTS=16 OP_TYPE 'vector_l2_ops';\n-- 前置操作会创建并写入 1200 个确定性向量；随后查询真实中心分布。",
 rebuild:"ALTER TABLE demo_shop_ci.ivf_health_docs ALTER REINDEX idx_embedding_ivf IVFFLAT LISTS=32;\n-- 随后重新查询中心、entries 和空中心。",
 accident:"CREATE PITR demo_price_history FOR DATABASE demo_pitr_shop RANGE 1 'h';\n-- 建立六件商品的价格表并记录正常时间点。\nUPDATE demo_pitr_shop.prices SET price=0;\nDROP TABLE demo_pitr_shop.prices;",
 restore:"-- 使用上一操作保存的正常时间点执行 RESTORE DATABASE。\n-- 随后逐列比对 product_id、name、price，而不只看行数。",
};
function timeline(trace=[]){
 return `<div class="sql-timeline" aria-label="操作执行时间线"><div class="timeline-heading"><strong>执行时间线</strong><span>${trace.length} 次 SQL / Shell / REST 调用 · 按实际执行顺序</span></div>${trace.map((t,i)=>{
 const running=t.status==='running',status=running?'running':t.ok?'success':'error';
 const elapsed=running?Math.max(0,Math.round(Date.now()-t.started_at*1000)):t.duration_ms;
 const kind=t.source==='shell'?'Shell 命令':t.source==='rest'?'REST 请求':'SQL / 事务批次';
 return `<article class="timeline-entry ${status}"><span class="timeline-node">${running?'◌':t.ok?'✓':'!'}</span><div class="timeline-content"><header><strong>${String(i+1).padStart(2,'0')} · ${running?'执行中':t.ok?'执行成功':'调用失败'}</strong><span>${h(t.source)} ${t.user?'· '+h(t.user):''} · <time ${running?`data-started-at="${Number(t.started_at)}"`:''}>${elapsed??'—'} ms</time></span></header>${sqlBlock(t.sql,'实际执行的'+kind)}<div class="timeline-response"><small>${running?'等待响应':'实际响应'}</small><pre>${h(running?'执行中…':t.result)}</pre></div></div></article>`;
 }).join('')}${!trace.length?'<p class="docs-hint">等待第一条数据库调用；服务准备可能需要一些时间。</p>':''}</div>`;
}
export function renderCase(state){
 const c=state.case;if(!c)return '<p>无法读取案例，请重启最新的 demo 服务。</p>';
 const next=c.steps.find(s=>!c.completed.includes(s.id));
 return `<section id="case-workbench" class="case-workbench"><div class="guide-mini-label">INDEPENDENT CASE / ${h(c.namespace)}</div><h3>在这一页，从零完成实验</h3><p>本案例有独立的数据和进度。按顺序准备、操作、验收；不需要先完成主线场景，也不会重置其他能力的数据。</p><div class="guide-case-state">${c.verified?'✓ 本案例全部验收通过':`${c.completed.length} / ${c.steps.length} 步完成`}</div><nav class="guide-scenario-path" aria-label="本案例步骤">${c.steps.map((s,i)=>`<button class="btn ${next?.id===s.id?'primary':'ghost'}" data-case-select="${s.id}">${c.completed.includes(s.id)?'✓':i+1} ${h(s.title)}</button>`).join('')}</nav><div id="case-stage"></div><div class="action-row"><button class="btn ghost" id="case-reset">重置本案例</button><button class="btn ghost" id="case-view-evidence">查看本次机制图与指标 ↑</button><a class="text-link" href="/demo.html">也可阅读贯穿全篇的业务场景 ↗</a></div><p class="docs-hint">重置只删除 ${h(c.namespace)} 开头的演示 SQL 对象及本案例进度。依赖、服务和湖端历史保留；下一轮 Iceberg 使用新命名空间。</p>${c.reset?`<details><summary>上次重置已核对 · 查看清理记录</summary>${c.reset.trace.map(t=>sqlBlock(t.sql,t.source==='shell'?'实际清理命令':'实际清理 SQL')).join('')}</details>`:''}</section>`;
}
export function wireCase(root,state,onUpdate){
 const host=root.querySelector('#case-workbench');if(!host||!state.case)return;
 let c=state.case;let selected=c.selected||(c.steps.find(s=>!c.completed.includes(s.id))||c.steps.at(-1)).id,busy=false;
 function draw(preserve=false){
  const step=c.steps.find(s=>s.id===selected),record=c.records[selected],next=c.steps.find(s=>!c.completed.includes(s.id)),index=c.steps.indexOf(step);
  const markup=`<div class="guide-step"><div class="guide-step-index">${index+1}</div><div class="guide-step-body"><h3>${h(step.title)}</h3><p>${h(step.why)}</p>${sqlBlock(step.sql||STEPS.find(s=>s.id===selected)?.sql||preview[selected]||'-- 本步涉及外部服务或动态参数，执行后展示真实请求、SQL 与返回结果。','执行前阅读 · SQL / 操作说明')}<div class="action-row"><button id="case-run" class="btn primary" ${busy||selected!==next?.id?'disabled':''}>${c.completed.includes(selected)?'✓ 本步已完成':'执行这一步 ▶'}</button>${index<c.steps.length-1?`<button class="btn ghost" data-case-select="${c.steps[index+1].id}">下一步 →</button>`:''}</div><div id="case-status" aria-live="polite">${record?.ok?'✓ 本步已完成':h(record?.error||'尚未执行，不显示模拟成功结果。')}</div>${record?`<div class="db-results"><h4>本次执行</h4>${record.result?.vectors?`<p>向量 ${record.result.vectors} · 中心 ${record.result.centroids} · 空中心 ${record.result.empty_centroids} · 负载比 ${h(record.result.balance_ratio)}</p>`:''}${timeline(record.trace)}${record.result?.checks?`<section class="case-validation ${record.ok?'passed':'failed'}"><h4>结果验证 · ${record.ok?'全部通过':'未通过'}</h4><p>下面逐项对照验收条件和实际查询结果。${record.error?'失败原因：'+h(record.error):''}</p>${record.result.checks.map(check=>`<details ${check.passed===false?'open':''} class="${check.passed===false?'failed':'passed'}"><summary>${check.passed===false?'✕':'✓'} ${h(check.title||check.check)} · ${check.passed===false?'未通过':'通过'}</summary><p>验收条件：${h(check.purpose||'核对实际返回值')}</p>${check.error?`<p class="pitr-error">${h(check.error)}</p>`:''}${check.sql?sqlBlock(check.sql,'验收查询'):''}${check.rows?.length?resultTable(check.columns,check.rows):'<p>查询未返回可展示的行。</p>'}</details>`).join('')}</section>`:''}${record.result?.records?`<details><summary>REST / Shell 执行记录</summary>${record.result.records.map(r=>`${sqlBlock(r.code,r.phase)}<p>${h(r.result)}</p>`).join('')}</details>`:''}<p>${h(record.ok?'本步通过。时间线保留实际操作、响应和耗时。':'本步未通过，修复后重试；也可重置本案例从头开始。')}</p></div>`:''}</div></div>`;
  host.setAttribute('aria-busy',String(busy));
  host.querySelectorAll('[data-case-select],#case-view-evidence').forEach(button=>button.disabled=busy);
  const stage=host.querySelector('#case-stage');
  if(preserve){
   // Keep the focused toolbar and SQL preview in the DOM; only the receipt changes.
   const template=document.createElement('template');template.innerHTML=markup;
   const result=template.content.querySelector('.db-results'),old=stage.querySelector('.db-results');
   if(result){if(old)old.replaceWith(result);else stage.querySelector('.guide-step-body').append(result);wireCopy(result);}
   else old?.remove();
   const button=host.querySelector('#case-run');button.textContent=c.completed.includes(selected)?'✓ 本步已完成':'执行这一步 ▶';button.disabled=busy||selected!==next?.id;
   host.querySelector('#case-status').textContent=record?.ok?'✓ 本步已完成':record?.error||'尚未执行，不显示模拟成功结果。';
  }else{stage.innerHTML=markup;wireCopy(stage);}
  host.querySelector('.guide-case-state').textContent=c.verified?'✓ 本案例全部验收通过':`${c.completed.length} / ${c.steps.length} 步完成`;
  host.querySelectorAll('nav [data-case-select]').forEach((button,i)=>{const id=button.dataset.caseSelect;button.textContent=`${c.completed.includes(id)?'✓':i+1} ${c.steps[i].title}`;button.classList.toggle('primary',id===next?.id);button.classList.toggle('ghost',id!==next?.id);button.setAttribute('aria-current',String(id===selected));});
 }
 function accept(updated,reset=false){
  const position={top:scrollY,left:scrollX,behavior:'instant'};
  state=updated;c=updated.case;busy=false;
  if(reset)selected=c.steps[0].id;
  else c.selected=selected;
  onUpdate(updated);
  draw(!reset);
  host.querySelector('#case-reset').disabled=false;
  if(!reset)window.scrollTo(position);
 }

 host.addEventListener('click',async e=>{
  if(e.target.closest('#case-view-evidence')&&!busy){onUpdate(state,{showEvidence:true});return;}
  const select=e.target.closest('[data-case-select]');if(select&&!busy){selected=select.dataset.caseSelect;draw();host.querySelector('#case-stage').scrollIntoView({block:'start',behavior:'instant'});return;}
  const run=e.target.closest('#case-run'),reset=e.target.closest('#case-reset');if((!run&&!reset)||busy)return;
  if(reset&&!confirm(`删除本案例 ${c.namespace} 的数据与进度？其他能力和主线数据保留。`))return;
  busy=true;host.setAttribute('aria-busy','true');host.querySelectorAll('[data-case-select],#case-view-evidence').forEach(button=>button.disabled=true);host.querySelector('#case-run').disabled=true;host.querySelector('#case-run').textContent='正在执行…';host.querySelector('#case-reset').disabled=true;host.querySelector('#case-status').textContent=reset?'正在清理并核对本案例…':'正在执行本步，等待真实结果…';
  let polling=false;
  const timer=reset?null:setInterval(async()=>{
   if(polling)return;polling=true;
   try{const live=await api('state');if(!busy||live.case?.running_step!==selected)return;
    const stage=host.querySelector('#case-stage .guide-step-body');
    let receipt=stage.querySelector('.db-results');if(!receipt){receipt=document.createElement('div');receipt.className='db-results';stage.append(receipt);}
    const trace=live.case.live_trace||[];
    const signature=JSON.stringify(trace);
    if(receipt.dataset.trace!==signature){receipt.innerHTML=timeline(trace);receipt.dataset.trace=signature;wireCopy(receipt);}
    receipt.querySelectorAll('time[data-started-at]').forEach(node=>{node.textContent=`${Math.max(0,Math.round(Date.now()-Number(node.dataset.startedAt)*1000))} ms`;});
    host.querySelector('#case-status').textContent=`执行中 · ${trace.filter(t=>t.status!=='running').length} 次调用已返回`;
   }catch{}finally{polling=false;}
  },800);
  try{const updated=await api('case',reset?{action:'reset',confirm:'reset-case'}:{action:'run',step:selected});accept(updated,Boolean(reset));}
  catch(error){const updated=await api('state').catch(()=>null);if(updated)accept(updated);else{busy=false;draw(true);host.querySelector('#case-reset').disabled=false;}host.querySelector('#case-status').textContent=error.message;}
  finally{clearInterval(timer);}

 });draw();
}
