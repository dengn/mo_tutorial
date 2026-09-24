import {$,h,fmt,api,shell,updateProgress,sqlBlock,wireCopy,done,toast,resultTable} from './common.js';

shell('lab');
let state=await api('state').catch(()=>({completed:[],metrics:{},evidence:[]}));
let tab=new URLSearchParams(location.search).get('tab')||'search';
if(!['search','order','sql'].includes(tab))tab='search';
let output='';

function table(columns,rows){return rows?.length?`<div style="overflow:auto"><table class="data-table"><thead><tr>${columns.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${h(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">查询已执行，返回 0 行。</div>';}
function render(){
  updateProgress(state);
  const readySearch=done(state,'search'), readyOrder=done(state,'release'), readySQL=done(state,'start');
  $('#app').innerHTML=`<section class="page-intro"><div class="eyebrow">Hands-on / 实验台</div><h1>继续操作真实数据。</h1><p>运行搜索、提交订单，或写一条只读 SQL。每次操作都由本地 v4.2.4 服务执行，结果会记录在 SQL 证据页。</p></section><div class="tabs" role="tablist"><button class="tab ${tab==='search'?'active':''}" data-tab="search">全文与向量</button><button class="tab ${tab==='order'?'active':''}" data-tab="order">下单与分析</button><button class="tab ${tab==='sql'?'active':''}" data-tab="sql">SQL 查询</button></div>
  <div class="lab-panel"><section>${tab==='search'?`<h2>改变搜索方式</h2><p>关键词通过全文索引查商品；向量查询按距离排序。价格和库存直接来自同一张业务表。</p><div class="field"><label for="search-mode">检索模式</label><select id="search-mode"><option value="keyword">全文关键词</option><option value="vector">意图向量</option></select></div><div id="search-field" class="field"><label for="search-value">关键词</label><input id="search-value" value="charger" maxlength="60"></div><button id="submit-search" class="btn primary" ${readySearch?'':'disabled'}>执行搜索 SQL →</button><p class="query-alert">${readySearch?'可用：搜索索引已建立。':'请先在逐步演示中完成“全文、向量与文档检索”。'}</p>`:tab==='order'?`<h2>下单后立即分析</h2><p>事务内扣库存并写订单。提交后查询订单数和销售额，观察实时变化。</p><div class="field"><label for="product">选择商品</label><select id="product"><option value="1">Travel GaN Charger 65W</option><option value="2">Multiport Travel Adapter</option><option value="3">Gaming Mechanical Keyboard</option><option value="4">Bluetooth Earbuds</option><option value="5">Ceramic Coffee Cup</option><option value="6">Portable Power Bank</option></select></div><div class="field"><label for="qty">数量 1–5</label><input id="qty" type="number" min="1" max="5" value="1"></div><button id="submit-order" class="btn primary" ${readyOrder?'':'disabled'}>提交订单并查询报表 →</button><p class="query-alert">${readyOrder?'可用：业务表与正式价格已准备。':'请先在逐步演示中完成“验证通过后上线”。'}</p>`:`<h2>自己运行一条 SQL</h2><p>编辑下方查询并执行。实验台只接受单条 SELECT 或 SHOW，查询范围限定为本地演示数据。</p><div class="preset-row"><button class="preset" data-sql="SELECT VERSION();">服务版本</button><button class="preset" data-sql="SELECT COUNT(*) AS order_count FROM demo_shop.orders;">订单行数</button><button class="preset" data-sql="SELECT product_id, name, price, stock FROM demo_shop.products LIMIT 6;">商品目录</button><button class="preset" data-sql="SELECT COUNT(*) AS clone_rows FROM demo_shop_ci.orders;">Clone 行数</button></div><div class="field"><label for="query-text">SQL 编辑器</label><textarea id="query-text" spellcheck="false">SELECT VERSION();</textarea></div><button id="submit-query" class="btn primary" ${readySQL?'':'disabled'}>执行 SQL →</button><p class="query-alert">${readySQL?'结果最多显示前 100 行；SQL 和返回行数记入证据页。':'请先启动本地 MatrixOne。'}</p>`}</section>
  <aside class="lab-output"><h3>数据库返回 / RESULT</h3><div id="lab-result">${output||'<div class="empty-state">选择参数并执行。真实结果会出现在这里。</div>'}</div></aside></div><section id="lab-sql" class="section"></section>`;
  if(tab==='sql'){
    $('.lab-panel').classList.add('sql-mode');
    $('.lab-panel').innerHTML=`<div><h2>SQL 控制台</h2><p>选择示例或编辑查询。连接本地 MatrixOne v4.2.4，支持单条只读 SELECT / SHOW，结果最多显示 100 行。</p><div class="preset-row"><button class="preset" data-sql="SELECT VERSION();">服务版本</button><button class="preset" data-sql="SELECT COUNT(*) AS order_count FROM demo_shop.orders;">订单行数</button><button class="preset" data-sql="SELECT product_id, name, price, stock FROM demo_shop.products LIMIT 6;">商品目录</button><button class="preset" data-sql="SELECT COUNT(*) AS clone_rows FROM demo_shop_ci.orders;">Clone 行数</button></div><div class="db-console lab-console"><div class="db-console-top"><div class="db-console-title"><span class="console-window-dots"><i></i><i></i><i></i></span><strong>查询编辑器</strong></div><span class="db-connection"><i class="status-dot ${readySQL?'is-live':''}"></i>MatrixOne v4.2.4 · 127.0.0.1:16042</span></div><div class="db-console-tabs"><span class="active">查询 1</span><span class="db-console-context">只读会话</span></div><div class="db-editor"><div id="lab-gutter" class="db-gutter"><span>1</span></div><textarea id="query-text" class="db-sql-input" aria-label="SQL 编辑器" spellcheck="false">SELECT VERSION();</textarea></div><div class="db-console-toolbar"><button id="submit-query" class="btn primary" ${readySQL?'':'disabled'}>▶ 执行查询</button><span class="db-shortcut">Ctrl / ⌘ + Enter</span><span id="lab-query-status" class="check-state">${readySQL?'就绪':'请先启动 MatrixOne'}</span></div><div class="db-results"><div class="db-result-tabs"><span class="active">结果</span><span>消息</span></div><div id="lab-result" class="check-result">${output||'<div class="db-empty">运行查询后，结果表格将在这里显示。</div>'}</div></div><div class="db-console-foot"><span>LOCAL CONNECTION</span><span>SELECT / SHOW · 100 行上限</span></div></div></div>`;
    const editor=$('#query-text'),gutter=$('#lab-gutter');
    const lines=()=>{gutter.innerHTML=Array.from({length:Math.max(1,editor.value.split('\n').length)},(_,index)=>`<span>${index+1}</span>`).join('');};
    editor.addEventListener('input',lines);editor.addEventListener('scroll',()=>{gutter.scrollTop=editor.scrollTop;});
    editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('#submit-query').click();}});
  }
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{tab=btn.dataset.tab;output='';history.replaceState(null,'',`/lab.html?tab=${tab}`);render();}));
  $('#search-mode')?.addEventListener('change',e=>{$('#search-field').innerHTML=e.target.value==='keyword'?'<label for="search-value">关键词</label><input id="search-value" value="charger" maxlength="60">':'<label for="search-value">场景意图</label><select id="search-value"><option value="travel">旅行充电</option><option value="gaming">安静游戏</option><option value="audio">无线音频</option></select>';});
  document.querySelectorAll('.preset').forEach(btn=>btn.addEventListener('click',()=>{$('#query-text').value=btn.dataset.sql;$('#query-text').dispatchEvent(new Event('input'));$('#query-text').focus();}));
  $('#submit-search')?.addEventListener('click',()=>perform('search',{mode:$('#search-mode').value,query:$('#search-value').value}));
  $('#submit-order')?.addEventListener('click',()=>perform('order',{product_id:Number($('#product').value),qty:Number($('#qty').value)}));
  $('#submit-query')?.addEventListener('click',()=>perform('query',{sql:$('#query-text').value}));
}

async function perform(kind,body){
  const btn=$(`#submit-${kind}`);btn.disabled=true;btn.textContent='正在执行…';
  const started=performance.now();
  try{
    const result=await api(kind,body);
    if(kind==='search'){
      const fields=body.mode==='keyword'?['id','name','price','stock','score']:['id','name','price','stock','distance'];
      output=`<div class="result-line">${h(result.rows.length)} 条结果 · ${h(body.mode==='keyword'?'全文索引':'向量距离')}</div>${table(fields,result.rows.map(row=>fields.map(key=>row[key])))}`;
    } else if(kind==='order'){
      output=`<div class="result-line">订单 #${h(result.order.id)} 已提交 · ¥${h(result.order.amount)}</div>${table(['指标','当前值'],[['商品',result.order.product],['剩余库存',result.order.stock_after],['订单总数',fmt(result.report.orders)],['销售总额','¥'+result.report.revenue]])}`;
    } else {
      output=`<div class="check-result-meta"><span class="status-dot is-live"></span><strong>成功</strong><span>MatrixOne v4.2.4</span><span>${result.rows.length} 行${result.truncated?' · 仅显示前 100 行':''}</span><span>${Math.round(performance.now()-started)} ms</span></div>${resultTable(result.columns,result.rows)}`;
    }
    $('#lab-result').innerHTML=output;
    state=await api('state');updateProgress(state);
    const proof=state.evidence?.at(-1);
    $('#lab-sql').innerHTML=proof?`<div class="section-head"><div><div class="eyebrow">Executed SQL</div><h2>这次实际运行的 SQL</h2></div><a class="text-link" href="/evidence.html">查看所有记录 ↗</a></div>${sqlBlock(proof.sql,'本次 SQL')}<p class="sql-caption">${h(proof.result)}</p>`:'';
    wireCopy($('#lab-sql'));
    btn.disabled=false;btn.textContent=kind==='search'?'再次执行搜索 SQL →':kind==='order'?'继续下单 →':'▶ 再次执行';
    if(kind==='query'){$('#lab-query-status').textContent='查询成功';$('#lab-query-status').className='check-state ok';}
  }catch(err){btn.disabled=false;btn.textContent='▶ 重试查询';if(kind==='query'){$('#lab-result').innerHTML=`<div class="check-error">${h(err.message)}</div>`;$('#lab-query-status').textContent='执行失败';$('#lab-query-status').className='check-state error';}else toast(err.message);}
}
render();
