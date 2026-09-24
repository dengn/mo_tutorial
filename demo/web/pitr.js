import {caseSQL,caseId,h,done,api,sqlBlock,resultTable,wireCopy} from './common.js';

function contents(data,ready,selected='good',busy=false){
  const timestamp=data?.[selected==='bad'?'bad_at':'good_at'];
  const history=selected==='missing'?[]:data?.[selected==='bad'?'damaged':'before'];
  const restore=`RESTORE DATABASE demo_pitr_shop\nFROM PITR demo_price_history '${timestamp||'<所选的服务器本地时间>'}';`;
  const titles={good:'正常价格',bad:'误改为零价',missing:'表已误删'};
  return `<div class="pitr-heading"><span class="guide-mini-label">PITR / 按时间点恢复</span><h3>表被误删了，怎样回到事故前？</h3><p>预先为数据库开启保留策略，发生事故后，在仍被保留的历史中选择时间点。下面实际经历一次批量误改和误删，再按你选择的时间恢复。</p></div>
  <div class="pitr-compare"><div><strong>PITR 保留窗口</strong><p>策略生效后保留一段时间的历史，恢复时指定时间戳。这里创建 demo_price_history，覆盖 demo_pitr_shop 的最近 1 小时。</p></div><div><strong>命名快照</strong><p>主动保存一个确定状态，恢复时指定快照名。可选对照使用 demo_before_accident 快照找回报表。</p></div></div>
  <p>本实验把六件商品复制到独立库 <code>demo_pitr_shop</code>。<code>RESTORE DATABASE</code> 会把这个库回到所选时刻，之后发生的修改也会被回退。</p>
  <div class="pitr-actions"><button class="btn primary" data-pitr-action="prepare" ${!ready||busy?'disabled':''}>${data?'重新准备并模拟事故':'创建策略并模拟误改、误删'}</button><span>${ready?'真实执行约需数秒，期间记录两个不同的秒级时间点。':'先在下方案例准备商品样本；主线模式需完成商品入库。'}</span></div>
  <div class="pitr-window"><div class="pitr-window-label"><span>保留窗口 · RANGE 1 'h'</span><span>${data?`本次策略创建：${h(data.policy?.[0]?.[1]||'')} · ${h(data.timezone)}`:'策略创建之前的历史不能靠事后开启 PITR 找回'}</span></div><div class="pitr-time-track">${['good','bad','missing'].map((key,i)=>`<button data-pitr-point="${key}" aria-pressed="${selected===key}" ${busy?'disabled':''}><i>${i+1}</i><strong>${titles[key]}</strong><time>${data?h(key==='missing'?'DROP TABLE 后':data[key==='good'?'good_at':'bad_at']):['T₁ · 尚未记录','T₂ · 尚未记录','T₃ · 尚未执行'][i]}</time><small>${key==='good'?'6 行有效价格':key==='bad'?'6 行，价格全为 0':'查询应报表不存在'}</small></button>`).join('')}</div></div>
  <div class="pitr-evidence"><div><span class="guide-mini-label">所选历史 · ${titles[selected]}</span><p>这是事故准备时实际读取并保存的状态。点选节点只查看记录；点击恢复才修改数据库。</p>${data?(selected==='missing'?`<pre class="pitr-error">${h(data.missing_error)}</pre>`:resultTable(['商品 ID','名称','当时价格'],history)): '<p class="pitr-pending">等待真实执行后显示记录。</p>'}</div><div><span class="guide-mini-label">数据库当前状态</span><p>${data?.phase==='good'?'已恢复到正常价格，逐列匹配原始六件商品。':data?.phase==='bad'?'恢复命令成功，但六件商品仍为零价：选到了错误时间点。':data?.phase==='missing'?'表已被删除；尚未恢复。':data?.phase==='changed'?'当前值与两个历史点均不同，请核对表中业务值。':'尚未准备本次实验。'}</p>${data?.rows?.length?resultTable(['商品 ID','名称','当前价格'],data.rows):'<p class="pitr-pending">没有可显示的当前商品行。</p>'}</div></div>
  ${sqlBlock(selected==='missing'?'-- 表已被删除。请选择正常或零价时间点执行恢复。':restore,'按所选时间恢复 · 真实 SQL')}
  <div class="pitr-actions"><button class="btn primary" data-pitr-action="restore_${selected}" ${!data||selected==='missing'||busy?'disabled':''}>恢复到${selected==='bad'?'零价':'正常'}时间点</button><button class="btn ghost" data-pitr-action="inspect" ${!data||busy?'disabled':''}>重新查询当前结果</button><span class="pitr-status" aria-live="polite"></span></div>
  <details class="pitr-policy"><summary>与命名快照比较：可选的报表恢复演练</summary><p>升级前能主动建立确定基线时，可以创建命名快照。这个对照创建两项报表指标，建快照、删表，再按快照恢复；PITR 主线已经展示按窗口内的时间选择恢复状态。</p><button class="btn ghost" data-pitr-action="snapshot" ${!data||busy?'disabled':''}>执行快照恢复对照</button>${data?.snapshot_rows?resultTable(['指标','恢复值'],data.snapshot_rows):''}</details><details class="pitr-policy"><summary>查看实际 PITR 策略与核对 SQL</summary>${sqlBlock("SHOW PITR WHERE pitr_name='demo_price_history';\nSELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id;",'策略与业务值')}${data?resultTable(['策略','创建时间','修改时间','级别','账号','数据库','表','窗口','单位'],data.policy):'<p>执行后显示 SHOW PITR 原始结果。</p>'}</details>
  <p class="docs-hint">时间点必须在策略已生效且尚未过期的范围内。本机 v4.2.4 使用服务器本地时区解析恢复时间；实验从 SELECT NOW() 获取时间，并等待跨过秒边界。行数相同不足以证明业务正确，所以两次恢复都逐列比对价格。</p>`;
}
export function renderPitrLab(state){return `<section class="pitr-lab" id="pitr-lab" data-pitr-lab>${caseSQL(contents(state.pitr,done(state,'ingest')))}</section>`;}
export function wirePitrLab(root,state){
  const host=root.querySelector('[data-pitr-lab]');if(!host)return;
  let data=state.pitr,selected='good',busy=false;const ready=done(state,'ingest');
  const render=()=>{host.innerHTML=caseSQL(contents(data,ready,selected,busy));wireCopy(host);};
  host.addEventListener('click',async event=>{
    const point=event.target.closest('[data-pitr-point]');if(point&&!busy){selected=point.dataset.pitrPoint;render();return;}
    const button=event.target.closest('[data-pitr-action]');if(!button||busy)return;
    const action=button.dataset.pitrAction;if(caseId&&action!=='inspect'){document.getElementById('case-workbench')?.scrollIntoView();return;}if(action==='prepare')data=null;busy=true;render();host.querySelector('.pitr-status').textContent=action==='prepare'?'创建策略 → 记录正常值 → 误改 → 记录零价 → 误删…':'正在访问本机 MatrixOne…';
    try{data=await api('pitr',{action});if(action==='prepare')selected='good';busy=false;render();host.querySelector('.pitr-status').textContent='本机操作完成，结果已更新。';}
    catch(error){busy=false;render();host.querySelector('.pitr-status').textContent=error.message;}
  });
}
