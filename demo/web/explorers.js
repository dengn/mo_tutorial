import {caseId,caseSQL,api,h,done,stepHref} from './common.js';

const requirements={git4data:'clone',vector:'search',fulltext:'search',ingest:'schema',htap:'operate',recovery:'recover',pubsub:'pubsub',iceberg:'iceberg',cdc:'cdc'};
const introductions={
  git4data:['共享的数据，独立的实验','把“百万行大表 Clone”拆成引用、元数据与候选库增量，再把图与两库 SQL 结果对照。'],
  vector:['看见真实的 IVF 分组','六件商品和三个聚类中心来自本机索引；二维位置由真实四维向量投影，距离和排序仍使用四维 SQL。'],
  fulltext:['打开真实的倒排索引','查看索引中保存的词项位置、文档长度与 MATCH 得分，观察 TF-IDF 和 BM25 如何改变排序。'],
  ingest:['让质量规则产生可见的分流','直接读取外表的七行 CSV，改变门槛并重新执行 SQL，观察每一行进入哪条路径。'],
  htap:['从一笔订单追到聚合','把真实事务写入的订单、库存和同一张订单表上的汇总放在一张图里。'],
  recovery:['一场事故的证据链','按本机事件顺序查看快照、失败和恢复，再核对恢复表里的每个业务值。'],
  pubsub:['跨过账号边界，核对同一目录','分别读取源账号和订阅账号看到的行，展示发布范围与实际账号结果。'],
  iceberg:['两个引用，差在哪一行','并排读取当前与历史 Iceberg 引用，直接找出新增记录与金额差。'],
  cdc:['同一订单，两端落地','用同一个订单号读取 MatrixOne 与 MySQL，逐列核对增量是否到达。'],
};
const number=value=>Number(value).toLocaleString('zh-CN');
const buttons=(items,selected,field)=>`<div class="xp-controls" role="group">${items.map(([value,label])=>`<button type="button" data-xp-${field}="${h(value)}" aria-pressed="${value===selected}">${h(label)}</button>`).join('')}</div>`;
const note=(label,body)=>`<div class="xp-note"><small>${h(label)}</small><p>${h(body)}</p></div>`;
const code=(sql,label='本次读取 / SQL')=>`<div class="xp-query"><span>${h(label)}</span><code>${h(sql)}</code></div>`;
const rows=(heads,items,classes=[])=>`<div class="xp-table-wrap"><table class="xp-table"><thead><tr>${heads.map(head=>`<th>${h(head)}</th>`).join('')}</tr></thead><tbody>${items.map((row,i)=>`<tr class="${classes[i]||''}">${row.map(cell=>`<td>${h(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function renderExplorer(id,state){
  const [title,lead]=introductions[id]||[];
  if(!title)return '';
  const ready=done(state,requirements[id]);
  return `<section class="xp-explorer" data-explorer="${h(id)}" data-ready="${ready}"><header class="xp-head"><div><span>DATA EXPLORER / ${h(id.toUpperCase())}</span><h3>${h(title)}</h3><p>${h(lead)}</p></div><b class="xp-live-badge">${ready?'● 本机数据':'◇ 示例证据'}</b></header><div class="xp-body" aria-live="polite"><div class="xp-loading"><i></i>${ready?'正在读取 MatrixOne 的实际数据与索引…':'正在打开一次 v4.2.4 运行留下的示例证据…'}</div></div></section>`;
}

function gitView(data,ui){
  const phase=ui.phase,base=Number(data.baseline_rows||data.clone_rows),newSource=data.source_rows-base;
  const caption=[
    '快照固定的是一个可引用的数据库状态。下方区块表示已有数据；不把区块数量当作物理字节数。',
    'Clone 新建候选库的元数据引用。两库都能查到基线订单；已有订单不需要逐行再写一份。',
    'CI 修改只在候选库形成增量。后续正式库也继续产生订单，因而当前行数可以与 Clone 基线不同。'
  ][phase];
  const sql=["CREATE SNAPSHOT demo_promo_base FOR DATABASE demo_shop;","CREATE DATABASE demo_shop_ci CLONE demo_shop {snapshot='demo_promo_base'};", "SELECT price FROM demo_shop.products WHERE product_id=1;\nSELECT price FROM demo_shop_ci.products WHERE product_id=1;"][phase];
  return `<div class="xp-tools">${buttons([['0','01 快照'],['1','02 Clone'],['2','03 候选写入']],String(phase),'phase')}</div>
  <div class="xp-git-stage" data-phase="${phase}"><div class="xp-git-blocks"><small>既有订单数据 / 一份基线</small><div>${['A','B','C','D'].map(x=>`<b>${x}</b>`).join('')}</div><span>${number(base)} 行的共同起点</span></div><div class="xp-git-refs"><div class="xp-git-ref main"><small>正式库 demo_shop</small><strong>↳ A · B · C · D</strong><em>当前 ${number(data.source_rows)} 行 ${newSource>0?`· 基线后 +${number(newSource)}`:''}</em></div><div class="xp-git-ref candidate"><small>候选库 demo_shop_ci</small><strong>↳ A · B · C · D <i>+ Δ</i></strong><em>当前 ${number(data.clone_rows)} 行</em></div></div></div>
  <div class="xp-git-facts"><div><small>本机 Clone 耗时</small><strong>${h(data.clone_ms??'—')} <span>ms</span></strong></div><div><small>CI 当时的正式价</small><strong>¥${h(data.ci_source_price??'—')}</strong></div><div><small>CI 验证的候选价</small><strong>¥${h(data.ci_candidate_price??'—')}</strong></div></div>
  ${note('如何读这张图',caption)}${code(sql,'场景操作 / SQL')}<p class="xp-footnote">共享区块与 Δ 是存储机制示意。行数、价格和耗时来自本机；本演示没有测量底层对象存储的物理字节数。</p>`;
}

const palette=['#42d9bd','#9a8ff5','#e6b579','#75a9ee','#e986a8'];
const vec=value=>typeof value==='string'?JSON.parse(value):value;
function l2(a,b){return Math.sqrt(a.reduce((sum,x,i)=>sum+(x-b[i])**2,0));}
function xy(v){return [65+(v[0]-v[2]+1)*300,320-(v[1]-v[3]+1)*130];}
function vectorView(data,ui){
  const centers=data.centroids.map(([id,v])=>({id:Number(id),v:vec(v)}));
  const membership=new Map(data.entries.map(([center,id])=>[Number(id),Number(center)]));
  const products=data.products.map(([id,name,v,stock,price])=>({id:Number(id),name,v:vec(v),stock:Number(stock),price,center:membership.get(Number(id))}));
  const q=data.query_vector,nearest=[...centers].sort((a,b)=>l2(a.v,q)-l2(b.v,q)).slice(0,ui.probe).map(c=>c.id);
  const results=data.rows.map(([id,name,distance])=>({id:Number(id),name,distance:Number(distance)}));
  const selected=new Set(results.map(row=>row.id));
  const distances=new Map(data.distances.map(([id,d])=>[Number(id),Number(d)]));
  const exact=[...products].sort((a,b)=>distances.get(a.id)-distances.get(b.id)).slice(0,3).map(p=>p.id);
  const overlap=results.filter(row=>exact.includes(row.id)).length;
  const initialMembers=products.filter(p=>nearest.includes(p.center)).map(p=>p.id);
  const expanded=results.some(row=>!initialMembers.includes(row.id));
  const point=([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`;
  const [qx,qy]=xy(q);
  const svg=`<svg class="xp-vector-map" viewBox="0 0 700 370" role="img" aria-label="本机 IVF 索引的六个商品、三个中心和查询向量的二维投影"><defs><pattern id="xp-grid" width="35" height="35" patternUnits="userSpaceOnUse"><path d="M35 0 H0 V35" fill="none" stroke="#263443" stroke-width=".7"/></pattern></defs><rect width="700" height="370" fill="url(#xp-grid)"/>${centers.map(c=>{const [x,y]=xy(c.v);return `<circle cx="${x}" cy="${y}" r="${nearest.includes(c.id)?74:55}" fill="${palette[c.id%palette.length]}" fill-opacity="${nearest.includes(c.id)?.09:.025}" stroke="${palette[c.id%palette.length]}" stroke-opacity="${nearest.includes(c.id)?.7:.25}" stroke-dasharray="5 7"/>`;}).join('')}${nearest.map(id=>{const c=centers.find(x=>x.id===id);return `<path d="M${qx} ${qy} L${point(xy(c.v))}" stroke="#e7bf7e" stroke-width="1.5" stroke-dasharray="4 5"/>`;}).join('')}${products.map(p=>{const [x,y]=xy(p.v);return `<g class="xp-vector-point ${selected.has(p.id)?'returned':''}" transform="translate(${x} ${y})"><circle r="${selected.has(p.id)?10:7}" fill="${palette[(p.center||0)%palette.length]}"/><text y="-17">#${p.id}</text><title>${h(p.name)} · center ${p.center} · 四维距离 ${distances.get(p.id)}</title></g>`;}).join('')}${centers.map(c=>{const [x,y]=xy(c.v);return `<g class="xp-vector-center" transform="translate(${x} ${y})"><path d="M0 -10 L10 0 L0 10 L-10 0 Z" fill="${palette[c.id%palette.length]}"/><text y="26">C${c.id}</text></g>`;}).join('')}<g class="xp-vector-query" transform="translate(${qx} ${qy})"><circle r="14"/><circle r="4"/><text x="18" y="-10">QUERY</text></g></svg>`;
  return `<div class="xp-tools"><span>意图</span>${buttons([['travel','旅行充电'],['gaming','游戏设备'],['audio','无线音频']],ui.intent,'intent')}<span>nprobe</span>${buttons([['1','1'],['2','2'],['3','3']],String(ui.probe),'probe')}</div><div class="xp-vector-layout"><div>${svg}<p class="xp-axis">二维投影：横轴 = 维度 1 − 维度 3，纵轴 = 维度 2 − 维度 4；中心归属、距离和结果均来自四维索引 / SQL。</p></div><div class="xp-vector-results"><small>本次 SQL / TOP 3</small>${results.map((row,i)=>`<div><b>${String(i+1).padStart(2,'0')}</b><span>${h(row.name)}<small>#${row.id} · C${membership.get(row.id)}</small></span><strong>${row.distance.toFixed(3)}</strong></div>`).join('')}<p>与六行全量四维距离排序的 Top 3 重合 <b>${overlap}/3</b>。</p></div></div><div class="xp-centroid-ledger">${centers.map(c=>`<div class="${nearest.includes(c.id)?'active':''}"><b>C${c.id}</b><span>${products.filter(p=>p.center===c.id).map(p=>'#'+p.id).join(' · ')||'空'}</span><small>中心距离 ${l2(c.v,q).toFixed(3)}</small></div>`).join('')}</div>${note('nprobe 应怎样理解',`最近的 ${ui.probe} 个中心是图中的初始探测范围，包含商品 ${initialMembers.map(id=>'#'+id).join('、')||'无'}。${expanded?'最终 SQL 结果还包含这些组之外的商品；不要把 nprobe 误读为结果只能来自所示组。':'本次返回均在所示组内。'} 少量样本不能推断生产召回或延迟。`)}${code(data.sql)}<p class="xp-footnote">菱形是从真实 IVF 内部表读取的中心；圆点归属来自 entries 表。高亮圈表示 SQL 实际返回，不等同于底层每次读取的全部对象。</p>`;
}

function fulltextView(data,ui){
  const lengths=new Map(data.doc_lengths.map(([id,length])=>[String(id),Number(length)]));
  const postingCount=new Map();for(const [id] of data.postings)postingCount.set(String(id),(postingCount.get(String(id))||0)+1);
  const ids=[...new Set(data.postings.map(row=>String(row[0])))];
  const sourceLabels={products:'商品名称 + 描述',product_specs:'JSON 规格',product_docs:'Stage DOCX 正文'};
  const sourceText=id=>{const row=data.source_rows.find(row=>String(row[0])===id);return row?data.source==='products'?row[1]+' · '+row[2]:data.source==='product_specs'?row[1]:'DOCX → 商品 #'+row[1]:'—';};
  const ranked=data.rows.map((row,i)=>({id:String(row[0]),label:data.source==='products'?row[1]:data.source==='product_specs'?'JSON 商品规格':'说明书正文',score:data.source==='products'?Number(row[2]):null,rank:i+1}));
  const max=Math.max(.001,...ranked.map(x=>x.score||0));
  const planFound=data.plan.some(line=>line.includes('fulltext_index_scan'));
  const comparison=ui.source==='products'&&ui.term==='travel'&&ranked.length===2
    ? ui.algorithm==='TF-IDF'
      ? `两份文档各命中一次 travel；本次 TF-IDF 得分分别为 ${ranked[0].score.toFixed(4)} 与 ${ranked[1].score.toFixed(4)}。切换 BM25，观察长度 ${lengths.get(ranked[0].id)} / ${lengths.get(ranked[1].id)} tokens 是否改变排序。`
      : `本次 BM25 把 doc ${ranked[0].id} 排在首位，得分 ${ranked[0].score.toFixed(4)}，文档长度 ${lengths.get(ranked[0].id)} tokens。和 TF-IDF 切换对照，可直接看到评分模型对结果的影响。`
    : '先看索引中的词项与文档 ID，再看 MATCH 返回哪些业务行；parser、来源或评分方式改变时，两层都要重新核对。';
  return `<div class="xp-tools"><span>索引来源</span>${buttons([['products','商品文本'],['product_specs','JSON'],['product_docs','DOCX']],ui.source,'source')}${ui.source==='products'?`<span>词项</span>${buttons([['travel','travel'],['charger','charger'],['battery','battery']],ui.term,'term')}<span>评分</span>${buttons([['TF-IDF','TF-IDF'],['BM25','BM25']],ui.algorithm,'algorithm')}`:''}</div>
  <div class="xp-fulltext-layout"><div class="xp-fulltext-source"><small>01 / ${h(sourceLabels[data.source])}</small>${ids.length?ids.map(id=>`<div><b>doc ${h(id)}</b><span>${h(sourceText(id))}</span></div>`).join(''):'<p>未找到倒排项</p>'}</div><div class="xp-fulltext-postings"><small>02 / 内部倒排记录</small><strong>${h(data.term)} →</strong>${data.postings.map(([id,pos])=>`<div><b>doc ${h(id)}</b><span>pos ${h(pos)}</span></div>`).join('')}<p>pos 是索引记录中的位置；同一词项可在同一文档出现多次。</p></div><div class="xp-fulltext-ranked"><small>03 / MATCH 结果</small>${ranked.map(row=>`<div><b>${row.rank}. ${h(row.label)}</b><span>doc ${h(row.id)}${row.score!==null?` · score ${row.score.toFixed(4)}`:''}</span>${row.score!==null?`<i style="width:${Math.max(8,row.score/max*100)}%"></i>`:''}</div>`).join('')||'<p>0 行</p>'}</div></div>
  <div class="xp-fulltext-reads"><div><small>索引文档长度</small>${ids.map(id=>`<b>doc ${h(id)} <em>${lengths.get(id)??'—'} tokens</em></b>`).join('')||'<span>—</span>'}</div><div><small>计划检查</small><strong>${planFound?'✓ fulltext_index_scan':'本次计划未出现索引扫描'}</strong><span>查询结果与倒排记录来自同一个本地索引。</span></div></div>${note('为什么值得比较',comparison)}${code(data.sql)}<p class="xp-footnote">词项、pos、文档长度和得分均从本机 v4.2.4 读取。这里使用经典 FULLTEXT；FULLTEXT2 有独立配置。</p>`;
}

function ingestView(data,ui){
  const accepted=new Set(data.filtered.map(row=>String(row[0]))),actual=new Set(data.accepted.map(row=>String(row[0])));
  const reject=data.raw.length-accepted.size;
  const task=data.task_run;
  const orderNote=data.order_rows ? `订单基线最初由 Task 之后独立的 generate_series SQL 生成 1,000,000 行；当前 ${number(data.order_rows)} 行可能包含后续交易。demo_load_catalog 只导入商品。` : '订单基线尚未生成；下一章在 Task 导入商品后，另用 generate_series SQL 创建百万行订单。';
  const explanation=ui.min_price===0
    ? task?`当前 Task 最近一次运行是 ${task[0]}，影响 ${task[2]} 行；业务表现在 ${actual.size} 行。质量表中的 ${data.issues.length} 行由前一章节的 INSERT 单独写入。`:`当前只是执行外表查询和质量留痕；SQL Task 尚未运行，业务商品表现在 ${actual.size} 行。下一章创建并执行 demo_load_catalog。`
    : `只读 SELECT 把价格门槛改为 > ${ui.min_price}；候选集有 ${accepted.size} 行。它不会重建任务，也不会修改质量表或已经入库的 ${actual.size} 件商品。`;
  return `<div class="xp-ingest-route"><div><small>01 / 文件</small><strong>products.csv</strong><span>原始 CSV · ${data.raw.length} 行</span></div><i>→</i><div><small>02 / STAGE</small><strong>demo_supplier</strong><span title="${h(data.stage_url||'')}">${h(data.stage_url||'file:// 本地材料目录')}</span></div><i>→</i><div><small>03 / 外表</small><strong>supplier_feed</strong><span>stage://demo_supplier/products.csv</span></div></div><div class="xp-tools"><span>在外表上试算价格规则</span>${buttons([['0','> 0 · Task 使用'],['100','> 100'],['200','> 200']],String(ui.min_price),'min-price')}</div><div class="xp-ingest-summary"><div><small>外表实时读取</small><strong>${data.raw.length}</strong><span>原始文件未改变</span></div><div><small>本次 SELECT 放行</small><strong>${accepted.size}</strong><span>只读候选集</span></div><div><small>本次 SELECT 拦下</small><strong>${reject}</strong><span>规则计算结果</span></div></div>${rows(['ID','CSV 原始商品','价格','库存','本次 SELECT'],data.raw.map(([id,name,price,stock])=>[id,name,'¥'+price,stock,accepted.has(String(id))?'进入候选集':'被规则拦下']),data.raw.map(row=>accepted.has(String(row[0]))?'accepted':'rejected'))}<div class="xp-ingest-outcomes"><div><small>QUALITY_ISSUES / 已写入</small><strong>${data.issues.length} 行</strong><span>${data.issues.map(row=>'#'+row[0]+' · '+row[1]).join('；')||'无'}</span></div><div><small>SQL TASK / 最近运行</small><strong>${task?h(task[0]):'尚未执行'}</strong><span>${task?`手动触发 · 影响 ${h(task[2])} 行`:'demo_load_catalog 将在下一章创建并触发'}</span></div><div><small>DEMO_SHOP.PRODUCTS / 已入库</small><strong>${actual.size} 行</strong><span>${[...actual].map(id=>'#'+id).join(' · ')||'等待 Task 执行'}</span></div></div>${note('这次切换到底改变了什么',explanation)}${code(data.sql)}<p class="xp-footnote">${h(orderNote)}</p>`;
}

function htapView(data){
  const last=data.last_order,order=data.order[0]||[],product=data.product[0]||[];
  const count=Number(data.report[0]),amount=Number(data.report[1]),qty=Number(last.qty||order[2]||0);
  return `<div class="xp-transaction"><div><small>事务 / WRITE</small><h4>一次提交，两张表</h4><div class="xp-tx-row"><span>orders</span><strong>#${h(order[0]||'—')}</strong><em>数量 ${qty} · ¥${h(order[3]||'—')}</em></div><div class="xp-tx-row"><span>products</span><strong>${h(product[1]||'—')}</strong><em>库存 ${h(product[2]||'—')}</em></div></div><div class="xp-tx-arrow">→</div><div><small>同一订单表 / READ</small><h4>提交后立即聚合</h4><div class="xp-tx-metric"><span>COUNT(*)</span><strong>${number(count)}</strong></div><div class="xp-tx-metric"><span>SUM(amount)</span><strong>¥${number(amount)}</strong></div></div></div>${note('这条链路证明什么',`订单 #${order[0]||'—'} 的金额 ¥${order[3]||'—'} 来自当前表。聚合查询也直接访问 demo_shop.orders；本图展示一致的读写路径，不代表吞吐或延迟基准。`)}${code(data.sql)}`;
}

function recoveryView(data,ui){
  const events=data.events.slice(-3),active=events[Math.min(ui.event,events.length-1)];
  return `<div class="xp-recovery-track">${events.map((event,i)=>`<button type="button" data-xp-event="${i}" aria-pressed="${i===ui.event}"><small>${String(i+1).padStart(2,'0')} / ${h(new Date(event.at).toLocaleTimeString('zh-CN'))}</small><strong>${h(event.title)}</strong></button>`).join('')}</div><div class="xp-recovery-current"><div><small>选择的执行证据</small><strong>${h(active?.title||'—')}</strong><p>${h(active?.detail||'—')}</p></div><div><small>当前恢复表中的业务值</small>${data.metrics.map(([name,value])=>`<p><b>${h(name)}</b><strong>${number(value)}</strong></p>`).join('')}</div></div>${note('核对方法','删除后的查询错误与恢复事件都留在时间线。恢复后按 metric 逐项读取，而不是只看 RESTORE 的成功提示。')}${code(data.sql)}`;
}

function pubsubView(data,ui){
  const selected=ui.account==='source'?data.source:data.subscriber;
  const same=JSON.stringify(data.source)===JSON.stringify(data.subscriber);
  return `<div class="xp-tools">${buttons([['source','发布账号 · sys'],['subscriber','订阅账号 · demo_partner']],ui.account,'account')}</div><div class="xp-account-line"><div class="${ui.account==='source'?'active':''}"><small>发布范围</small><strong>demo_shop.products</strong><span>其他业务表不在此 Publication 中</span></div><i>PUBLICATION<br>→</i><div class="${ui.account==='subscriber'?'active':''}"><small>伙伴入口</small><strong>partner_catalog.products</strong><span>以 demo_partner:admin 会话查询</span></div></div>${rows(['ID','商品','价格'],selected)}${note('当前两端核对',`源账号 ${data.source.length} 行、订阅账号 ${data.subscriber.length} 行；逐行结果${same?'一致':'存在差异'}。切换上方账号，观察同一目录在两种数据库名称下的实际返回。`)}${code(data.sql)}`;
}

function icebergView(data,ui){
  const selected=ui.ref==='current'?data.current:data.historic;
  const old=new Set(data.historic.map(row=>String(row[0]))),added=data.current.filter(row=>!old.has(String(row[0])));
  const sum=rows=>rows.reduce((n,row)=>n+Number(row[2]),0);
  return `<div class="xp-tools">${buttons([['historic','历史引用'],['current','当前引用']],ui.ref,'ref')}</div><div class="xp-iceberg-refs"><div class="${ui.ref==='historic'?'active':''}"><small>HISTORIC</small><strong>${data.historic.length} 行</strong><span>金额 ${number(sum(data.historic))}</span></div><div class="xp-iceberg-delta"><span>新增 ${added.length} 行</span><b>+${number(sum(data.current)-sum(data.historic))}</b></div><div class="${ui.ref==='current'?'active':''}"><small>CURRENT</small><strong>${data.current.length} 行</strong><span>金额 ${number(sum(data.current))}</span></div></div>${rows(['订单 ID','bucket','金额','地区'],selected,selected.map(row=>added.some(x=>x[0]===row[0])?'new':''))}${note('从数据看快照差异',`当前引用比历史引用多 ${added.length} 行：${added.map(row=>'订单 #'+row[0]+'、金额 '+row[2]).join('；')||'无新增行'}。两个结果都由 MatrixOne 查询 Iceberg 表。`)}${code(data.sql)}`;
}

function cdcView(data){
  const source=data.source[0]||[],sink=data.sink[0]||[];
  const same=JSON.stringify(source)===JSON.stringify(sink);
  return `<div class="xp-cdc-grid"><div><small>MATRIXONE / SOURCE</small><strong>orders</strong>${source.length?rows(['order_id','product_id','qty','amount'],[source]):'<p>源端未命中</p>'}</div><div class="xp-cdc-pulse"><i></i><span>CDC TASK</span><i></i></div><div><small>MYSQL / SINK</small><strong>orders</strong>${sink.length?rows(['order_id','product_id','qty','amount'],[sink]):'<p>目标端未命中</p>'}</div></div>${note('真正的交付条件',`订单 #${data.order_id} 在源端 ${data.source.length} 行、目标端 ${data.sink.length} 行；四个字段${same?'逐列一致':'尚有差异'}。任务存在和检查点就绪本身不等于这笔订单已经到达。`)}${code(data.sql)}`;
}

const views={git4data:gitView,vector:vectorView,fulltext:fulltextView,ingest:ingestView,htap:htapView,recovery:recoveryView,pubsub:pubsubView,iceberg:icebergView,cdc:cdcView};
export function wireExplorer(root=document){
  const explorer=root.querySelector('[data-explorer]');if(!explorer)return;
  const id=explorer.dataset.explorer,body=explorer.querySelector('.xp-body'),ready=explorer.dataset.ready==='true';
  const ui={phase:0,intent:'travel',probe:1,source:'products',term:'travel',algorithm:'TF-IDF',min_price:0,event:0,account:'source',ref:'historic'};
  let seq=0,samplePromise;
  const sampleKey=()=>id==='vector'?`${ui.intent}:${ui.probe}`:id==='fulltext'?`${ui.source}:${ui.term}:${ui.algorithm}`:id==='ingest'?String(ui.min_price):'default';
  const viewHtml=data=>{
    const content=caseSQL(views[id](data,ui));
    return ready?content:`<div class="xp-preview-banner"><strong>示例数据 · v4.2.4</strong><span>来自一次完整本地运行。可先切换阅读；<a href="${caseId?'#case-workbench':stepHref(requirements[id])}">${caseId?'执行下方独立案例':'完成对应场景'}</a>后，这里会改为查询你的本机数据。</span></div>${content.replaceAll('本次读取 / SQL','示例 SQL / 对应查询').replaceAll('场景操作 / SQL','示例 SQL / 场景操作')}`;
  };
  async function load(){
    const current=++seq;
    body.classList.add('is-loading');
    try{
      const data=ready
        ? await api('insight',{feature:id,intent:ui.intent,probe:ui.probe,source:ui.source,term:ui.term,algorithm:ui.algorithm,min_price:ui.min_price})
        : (await (samplePromise??=fetch('./sample-insights.json').then(response=>{if(!response.ok)throw Error('示例证据暂不可用');return response.json();}))).features[id][sampleKey()];
      if(!data)throw Error('这组示例数据暂不可用');
      if(current!==seq)return;
      body.innerHTML=viewHtml(data);
      body.classList.remove('is-loading');
      body.querySelectorAll('[data-xp-phase],[data-xp-intent],[data-xp-probe],[data-xp-source],[data-xp-term],[data-xp-algorithm],[data-xp-min-price],[data-xp-event],[data-xp-account],[data-xp-ref]').forEach(button=>button.addEventListener('click',()=>{
        const key=Object.keys(button.dataset).find(name=>name.startsWith('xp'));
        const field=key.slice(2).replace(/^./,char=>char.toLowerCase()).replace(/[A-Z]/g,char=>'_'+char.toLowerCase());
        const value=button.dataset[key];
        if(field==='source'){
          ui.source=value;ui.term=value==='products'?'travel':value==='product_specs'?'gan':'warranty';
        }else ui[field]=['phase','probe','min_price','event'].includes(field)?Number(value):value;
        if(['phase','event','account','ref'].includes(field)){
          body.innerHTML=viewHtml(data);
          bindLocal(data);
        }else load();
      }));
    }catch(error){if(current===seq){body.classList.remove('is-loading');body.innerHTML=`<div class="xp-error">${h(error.message)} <button type="button" data-xp-retry>重试读取</button></div>`;body.querySelector('[data-xp-retry]').addEventListener('click',load);}}
  }
  function bindLocal(data){
    body.querySelectorAll('[data-xp-phase],[data-xp-event],[data-xp-account],[data-xp-ref]').forEach(button=>button.addEventListener('click',()=>{
      const key=Object.keys(button.dataset).find(name=>name.startsWith('xp'));
      const field=key.slice(2).replace(/^./,char=>char.toLowerCase()).replace(/[A-Z]/g,char=>'_'+char.toLowerCase());
      ui[field]=['phase','event'].includes(field)?Number(button.dataset[key]):button.dataset[key];
      body.innerHTML=viewHtml(data);bindLocal(data);
    }));
  }
  load();
}
