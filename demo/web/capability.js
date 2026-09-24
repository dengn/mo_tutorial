import {renderCase,wireCase} from './case-runner.js';
import {renderIcebergLesson,wireIcebergLesson} from './iceberg.js';
import {renderPitrLab,wirePitrLab} from './pitr.js';
import {CAPABILITIES,GUIDES,getCapability} from './catalog.js';
import {FEATURE_CONTENT} from './content.js';
import {TOPICS} from './topics.js';
import {READINGS} from './readings.js';
import {renderExplorer,wireExplorer} from './explorers.js';
import {$,h,api,shell,updateProgress,metricTiles,animateMetrics,sqlBlock,wireCopy,capHref,stepHref,done} from './common.js';

shell('home');
const id=new URLSearchParams(location.search).get('id')||'git4data';
const cap=getCapability(id),feature=FEATURE_CONTENT[id],guide=GUIDES[id];
let state,connectionError=null;
let scrollHandler=null;
try{state=await api('state');}catch(error){connectionError=error.message;state={completed:[],metrics:{},evidence:[]};}
const head=(number,title,lead)=>`<div class="guide-section-head"><span class="guide-number">${number}</span><div><h2>${title}</h2><p>${lead}</p></div></div>`;
const resultBars={git4data:[['source_rows','正式库'],['clone_rows','候选库']],ingest:[['external_rows','原始 CSV'],['rejected_rows','质量异常'],['products','有效商品']],fulltext:[['keyword_hits','自然语言'],['boolean_hits','布尔'],['json_hits','JSON'],['document_hits','文档']],iceberg:[['iceberg_current_rows','当前'],['iceberg_history_rows','历史']]};
function renderResultBars(id,state){
  const spec=resultBars[id];if(!spec)return '';
  const values=spec.map(([key,label])=>({label,value:Number(state.metrics?.[key])}));
  if(!values.every(item=>Number.isFinite(item.value)))return '';
  const max=Math.max(1,...values.map(item=>item.value));
  return `<div class="guide-result-bars" aria-label="执行时记录的行数对比"><div class="guide-mini-label">MEASURED / 本机记录的行数</div>${values.map(item=>`<div class="guide-result-bar"><span>${h(item.label)}</span><i><b style="--bar-width:${Math.max(3,item.value/max*100)}%"></b></i><strong>${h(item.value.toLocaleString('zh-CN'))}</strong></div>`).join('')}</div>`;
}

function healthLab(){
  if(id!=='vector')return '';
  return `<div class="guide-health" id="health"><div class="guide-mini-label">扩展实验 / IVF INDEX HEALTH</div><h3>索引建好后，还要看中心负载</h3><p>首次运行会用 1200 个确定性向量建立 LISTS=16 的 IVF 索引，并查询每个中心的 entries。重建可改为 LISTS=32；再次检查会读取当前索引，不会重置已有结果。负载比是否改善由数据库结果决定。</p><div class="action-row"><button type="button" class="btn primary" id="health-check" ${done(state,'search')?'':'disabled'}>建立样本并检查</button><button type="button" class="btn ghost" id="health-rebuild" ${done(state,'search')?'':'disabled'}>重建为 32 个中心</button></div>${!done(state,'search')?`<p class="docs-hint">先完成 <a href="${stepHref('search')}">检索场景章节 →</a></p>`:''}<div id="health-result" aria-live="polite"></div></div>`;
}
function render(){
  if(!cap||!feature){$('#app').innerHTML='<section class="page-intro"><h1>没有找到这项能力</h1><a class="btn" href="/">返回功能目录</a></section>';return;}
  document.title=`${cap.title} · MatrixOne 功能指南`;updateProgress(state);
  const topics=TOPICS[id]||[];
  const uses=feature.uses.map(([title,body],index)=>`<li><span>${String(index+1).padStart(2,'0')}</span><div><strong>${h(title)}</strong><p>${h(body)}</p></div></li>`).join('');
  const terms=guide.terms.map(([title,body])=>`<div><dt>${h(title)}</dt><dd>${h(body)}</dd></div>`).join('');
  const detail=topics.map((topic,index)=>`<details class="guide-topic" ${index===0?'open':''}><summary><span>${String(index+1).padStart(2,'0')}</span><strong>${h(topic.title)}</strong><i>展开</i></summary><div class="guide-topic-body"><p>${h(topic.summary)}</p><ol>${topic.steps.map(step=>`<li>${h(step)}</li>`).join('')}</ol><div class="guide-note"><strong>看什么结果</strong><p>${h(topic.verify)}</p></div></div></details>`).join('');
  const reading=(READINGS[id]||[]).map(([title,body],index)=>`<div class="guide-reading-item"><span>${String(index+1).padStart(2,'0')}</span><div><h4>${h(title)}</h4><p>${h(body)}</p></div></div>`).join('');
  const sql=feature.sql.map((item,index)=>`<div class="guide-sql-row" id="sql-${index+1}"><div class="guide-sql-explain"><span>SQL ${String(index+1).padStart(2,'0')}</span><h3>${h(item.title)}</h3><p>${h(item.why)}</p></div>${sqlBlock(item.code,item.kind||'MatrixOne SQL')}</div>`).join('');
  const sqlPath=`<nav class="guide-sql-path" aria-label="本章 SQL 执行路径"><span>执行路径</span>${feature.sql.map((item,index)=>`<a href="#sql-${index+1}" data-sql-path="${index+1}"><b>${String(index+1).padStart(2,'0')}</b>${h(item.title)}</a>`).join('')}</nav>`;
  const extraSQL=topics.length?`<details class="guide-extra-sql"><summary>查看专题 SQL 示例 <span>${topics.length} 组 ↘</span></summary>${topics.map((topic,index)=>`<div class="guide-extra-row"><h3>${String(index+1).padStart(2,'0')} / ${h(topic.title)}</h3><p>${h(topic.summary)}</p>${sqlBlock(topic.code,'专题 SQL · 复制后按说明使用')}</div>`).join('')}</details>`:'';
  const references=feature.references?.length?`<div class="guide-references"><strong>继续阅读</strong>${feature.references.map(([title,url])=>`<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(title)} ↗</a>`).join('')}</div>`:'';
  $('#app').innerHTML=`<div class="docs-layout capability-docs guide-layout"><aside class="docs-sidebar"><a class="docs-sidebar-brand" href="/">MATRIXONE / 功能指南</a><p>九项能力，逐项解释与实测</p><div class="docs-nav-group"><div class="docs-nav-heading">重点能力</div>${CAPABILITIES.slice(0,3).map(item=>`<a class="docs-nav-item ${item.id===id?'current':''}" href="${capHref(item.id)}"><span class="nav-status">${item.id===id?'◆':'•'}</span>${h(item.title)}</a>`).join('')}</div><div class="docs-nav-group"><div class="docs-nav-heading">数据路径</div>${CAPABILITIES.slice(3).map(item=>`<a class="docs-nav-item ${item.id===id?'current':''}" href="${capHref(item.id)}"><span class="nav-status">${item.id===id?'◆':'•'}</span>${h(item.title)}</a>`).join('')}</div><a class="text-link" href="/demo.html">完整场景 ↗</a></aside><article class="docs-article guide-article"><div class="docs-breadcrumb"><a href="/">功能目录</a><span>/</span>${h(cap.title)}</div><details class="docs-mobile-nav"><summary>切换功能 · ${h(cap.title)}</summary>${CAPABILITIES.map(item=>`<a class="docs-nav-item ${item.id===id?'current':''}" href="${capHref(item.id)}">${h(item.title)}</a>`).join('')}</details>${connectionError?`<div class="docs-connection error">${h(connectionError)}</div>`:`<div class="docs-connection"><span class="status-dot is-live"></span>本地执行服务已连接 · ${done(state,'start')?'MatrixOne v4.2.4 已启动':'数据库待启动'}</div>`}
  <header class="guide-hero"><span class="guide-kicker">${h(cap.tag)} / MATRIXONE 4.2.4</span><h1>${h(cap.title)}</h1><p class="guide-subtitle">${h(cap.subtitle)}</p><div class="guide-hero-bottom"><span>功能 → 细节 → SQL → 独立案例与验收</span><a href="#intro">开始阅读 ↓</a><a href="#case-workbench">从零实操 ↓</a>${id==='recovery'?'<a href="#pitr-lab">PITR 时间点实验 ↓</a>':''}</div></header>
  <section class="guide-section" id="intro">${head('01','功能介绍','先弄清这项能力解决什么问题，以及开发者在何时使用它。')}<div class="guide-lead"><p>${h(feature.definition)}</p><strong>${h(feature.essence)}</strong></div><div class="guide-use"><h3>在开发中有什么用</h3><ul>${uses}</ul></div></section>
  <section class="guide-section" id="details">${head('02','从机制到证据','先认识关键对象，再打开本机数据，观察它们在真实查询里如何协作。')}<dl class="guide-terms">${terms}</dl>${id==='recovery'?renderPitrLab(state):id==='iceberg'?renderIcebergLesson(state):renderExplorer(id,state)}${['recovery','iceberg'].includes(id)?'<p class="docs-hint">上图用于阅读与观察。<a href="#case-workbench">从下方完整案例开始准备、写入和恢复 →</a></p>':''}<div class="guide-reading"><div class="guide-reading-head"><span>READING THE EVIDENCE</span><h3>沿着证据往下读</h3></div>${reading}</div><div class="guide-topic-list"><h3>继续拆解</h3>${detail}</div><div class="guide-boundary"><strong>使用边界</strong><p>${h(guide.caution)}</p></div>${references}</section>
  <section class="guide-section" id="sql">${head('03',id==='iceberg'?'接入步骤与 SQL':'SQL 解释',id==='iceberg'?'依次区分 Shell、REST API 与 MatrixOne SQL；占位符会在逐步执行中替换为本机对象名。':'每段 SQL 都说明其目的；带占位符的示例需要按环境填写，实际执行由下方独立案例逐步完成。')}${sqlPath}<div class="guide-sql-list">${sql}</div>${extraSQL}</section>
  <section class="guide-section" id="scenario">${head('04','完整案例：准备、执行、验收、重置','从空的本案例数据开始，每一步解释用途，并以实际 SQL 与业务结果验收。')}<div class="guide-context"><span>为什么做这个实验</span><p>${h(guide.context)}</p></div>${renderCase(state)}${state.case?.verified?`<div class="guide-observe"><h3>验收后继续观察</h3><p>${h(guide.observe)}</p>${metricTiles(cap.evidence,state)}${renderResultBars(id,state)}</div>${healthLab()}`:''}</section></article><aside class="docs-toc"><strong>本页</strong><a href="#intro">01 功能介绍</a><a href="#details">02 细节补充</a><a href="#sql">03 SQL 解释</a><a href="#scenario">04 场景执行与解释</a><a href="#case-workbench">独立案例与重置</a>${id==='recovery'?'<a href="#pitr-lab">PITR 时间点实验</a>':''}${id==='iceberg'?'<a href="#iceberg-lab">从空湖表开始</a>':''}${id==='vector'?'<a href="#health">IVF 健康实验</a>':''}</aside></div>`;
  $('#app').insertAdjacentHTML('afterbegin','<div class="guide-scroll-track" aria-hidden="true"><i></i></div>');
  if(scrollHandler)window.removeEventListener('scroll',scrollHandler);
  scrollHandler=()=>{
    const max=document.documentElement.scrollHeight-innerHeight;
    $('.guide-scroll-track i').style.width=`${max>0?Math.min(100,Math.max(0,scrollY/max*100)):0}%`;
    let active='intro';
    for(const section of $('#app').querySelectorAll('.guide-section'))if(section.getBoundingClientRect().top<190)active=section.id;
    $('#app').querySelectorAll('.docs-toc a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+active));
  };
  window.addEventListener('scroll',scrollHandler,{passive:true});scrollHandler();
  wireCase($('#app'),state,(updated,options={})=>{
    state=updated;updateProgress(state);
    const connection=$('.docs-connection');
    if(connection&&!connectionError)connection.innerHTML=`<span class="status-dot is-live"></span>本地执行服务已连接 · ${done(state,'start')?'MatrixOne v4.2.4 已启动':'本案例待核对连接'}`;
    if(!state.case?.verified){$('.guide-observe')?.remove();$('.guide-health')?.remove();}
    if(options.showEvidence){render();document.getElementById('details')?.scrollIntoView({block:'start',behavior:'instant'});}
  });
  wireCopy();wireIcebergLesson($('#app'),state);wirePitrLab($('#app'),state);wireExplorer($('#app'));animateMetrics($('#app'));
  $('#app').querySelectorAll('[data-pitr-action],[data-lake-action]').forEach(button=>{if(button.dataset.pitrAction!=='inspect'&&button.dataset.lakeAction!=='inspect'){button.disabled=true;button.title='写入和恢复操作请在下方独立案例中按步骤执行';}});
  $('#app').querySelectorAll('[data-sql-path]').forEach(link=>link.addEventListener('click',()=>{
    $('#app').querySelectorAll('[data-pitr-action],[data-lake-action]').forEach(button=>{if(button.dataset.pitrAction!=='inspect'&&button.dataset.lakeAction!=='inspect'){button.disabled=true;button.title='写入和恢复操作请在下方独立案例中按步骤执行';}});
  $('#app').querySelectorAll('[data-sql-path]').forEach(item=>item.classList.toggle('active',item===link));
    const row=$(`#sql-${link.dataset.sqlPath}`);row?.classList.add('guide-sql-focus');setTimeout(()=>row?.classList.remove('guide-sql-focus'),1600);
  }));
  for(const [buttonId,action] of [['health-check','check'],['health-rebuild','rebuild']]){
    $('#'+buttonId)?.addEventListener('click',async()=>{
      const button=$('#'+buttonId),output=$('#health-result');
      $('#health-check').disabled=$('#health-rebuild').disabled=true;button.textContent=action==='check'?'正在检查中心…':'正在重建并复查…';
      output.innerHTML='<div class="feature-health-loading"><i></i>正在读取本地 MatrixOne 的索引分布。</div>';
      try{const data=await api('vector-health',{action}),counts=data.rows.map(row=>row[1]);
        output.innerHTML=`<div class="feature-health-stats"><div><span>向量数</span><strong>${h(data.vectors)}</strong></div><div><span>中心数</span><strong>${h(data.centroids)}</strong></div><div><span>空中心</span><strong>${h(data.empty_centroids)}</strong></div><div><span>负载比</span><strong>${h(data.balance_ratio??'—')}</strong></div></div><div class="feature-health-chart" aria-label="IVF 中心负载分布">${data.rows.map(([center,count])=>`<div title="中心 ${h(center)}：${h(count)} 个向量"><span style="height:${Math.max(3,Math.round(count/Math.max(...counts)*100))}%"></span><small>${h(center)}</small></div>`).join('')}</div><div class="feature-health-sql">${sqlBlock(data.sql,'刚才执行的分布查询')}</div><p class="docs-hint">LISTS=${h(data.lists)}。负载比 = 非空中心最大值 / 最小值；空中心单独统计。结果来自当前索引。</p>`;wireCopy(output);
      }catch(error){output.innerHTML=`<div class="check-error">${h(error.message)}</div>`;}
      button.textContent=action==='check'?'再次检查':'重建为 32 个中心';$('#health-check').disabled=$('#health-rebuild').disabled=false;
    });
  }
}
render();
