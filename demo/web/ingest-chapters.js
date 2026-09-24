import {h,done} from './common.js';

const value=(state,key,fallback='待执行')=>state.metrics?.[key]===undefined?fallback:h(state.metrics[key]);

export function renderIngestLesson(id,state){
  if(id==='schema')return `<div class="ingest-lesson" aria-label="Stage 与外表的四步读写路径">
    <div class="ingest-lesson-heading"><span>READ PATH / 文件如何变成可查询的行</span><h3>这一章先解决“能读什么”，再记录“哪里有错”</h3><p>文件、Stage、外表和质量表不是同一个对象。本章还创建空的 products、orders、product_docs 目标表；商品行要等下一章的 Task 才会进入 products。</p></div>
    <div class="ingest-lesson-grid">
      <div><small>01 / 文件已存在</small><strong>products.csv</strong><p>供应商给七行 CSV，#7 的价格是 −8。文件保留原样，方便追溯。</p><code>demo/runtime/fixtures/</code></div>
      <div><small>02 / 给目录命名</small><strong>demo_supplier</strong><p><b>CREATE STAGE</b> 指向 file:// 目录；SHOW STAGES 可以核对地址。此时没有商品行被导入。</p><code>file://…/fixtures/</code></div>
      <div><small>03 / 告诉 SQL 怎样读</small><strong>supplier_feed</strong><p><b>CREATE EXTERNAL TABLE</b> 定义列与 CSV 格式，使用 Stage 地址。SELECT 才去读取七行。</p><code>stage://demo_supplier/products.csv</code></div>
      <div><small>04 / 单独写入异常</small><strong>quality_issues</strong><p><b>INSERT ... SELECT</b> 把负价行的 ID 和原因写进质量表；原始 CSV 仍是七行。</p><code>price &lt;= 0 OR stock &lt; 0</code></div>
    </div>
    <div class="ingest-lesson-proof"><span>本章执行时记录</span><b>外表 ${value(state,'external_rows')} 行</b><b>质量表 ${value(state,'rejected_rows')} 行</b><p>下方“在控制台重新查询”可分别查看 Stage 地址、CSV 七行与异常 ID；它们来自不同位置。</p></div>
  </div>`;
  if(id==='ingest')return `<div class="ingest-lesson" aria-label="SQL Task 的定义、执行与验证">
    <div class="ingest-lesson-heading"><span>SQL TASK / 先认识任务，再执行任务</span><h3><code>demo_load_catalog</code> 是什么？</h3><p>它是本章用 <code>CREATE TASK demo_load_catalog AS BEGIN ... END</code> 新建的<strong>具名数据库任务</strong>。名字由我们起；真正的工作写在 BEGIN 与 END 之间。</p></div>
    <div class="ingest-task-body"><div class="ingest-task-name"><small>任务体 / 只有一条写入</small><strong>INSERT INTO demo_shop.products<br>SELECT … FROM demo_ingest.supplier_feed</strong></div><div class="ingest-task-rules"><div><b>price &gt; 0</b><span>丢弃负价商品 #7</span></div><div><b>stock &gt;= 0</b><span>库存不能为负</span></div><div><b>NOT EXISTS</b><span>目标表已有相同 product_id 时不再插入</span></div></div></div>
    <div class="ingest-task-sequence"><div><small>01 / 定义</small><strong>CREATE TASK</strong><p>把任务名和 SQL 体保存到数据库。示例里的 DELIMITER // 只是 mysql 客户端为 BEGIN 内分号切换语句结束符。</p></div><div><small>02 / 触发</small><strong>EXECUTE TASK demo_load_catalog</strong><p>按已保存的任务名手动运行；这句本身不包含清洗规则，也不创建任务。</p></div><div><small>03 / 验证</small><strong>SHOW TASK RUNS</strong><p>核对 MANUAL、SUCCESS 与 rows_affected，再 SELECT 业务商品表的六行。</p></div></div>
    <div class="ingest-lesson-proof"><span>本章执行时记录</span><b>Task ${value(state,'task_status')}</b><b>商品 ${value(state,'products')} 行</b><p>${done(state,'ingest')?'本机已经运行这个任务。':'执行后这里会显示本机记录。'} Task 后，脚本另为商品写入预置向量、写入指向 DOCX 的 DATALINK 引用，并用 generate_series 生成 ${value(state,'orders')} 行订单；<strong>这些都不在 Task 的 SQL 体里</strong>。</p></div>
  </div>`;
  return '';
}
