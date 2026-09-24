export const ACTS = [
  {id: "foundation", number: "01", title: "数据准备", range: "01–04", line: "把文件变成可信的业务数据。"},
  {id: "delivery", number: "02", title: "验证与检索", range: "05–08", line: "在真实规模上试错，再交付搜索升级。"},
  {id: "business", number: "03", title: "业务与恢复", range: "09–10", line: "观察交易、分析与事故恢复。"},
  {id: "open", number: "04", title: "开放连接", range: "11–13", line: "把数据共享到账号、湖表和其他系统。"},
];

export const CAPABILITIES = [
  {
    id: "git4data", tag: "重点 01", title: "Git for Data", subtitle: "大表 Clone，让真实数据进入 CI",
    summary: "基于快照 Clone 百万行订单库，复用已有数据块，在独立候选库中以增量写入完成测试和验证。",
    value: "开发者需要在真实数据规模上验证变更，又不希望测试写入影响正式库。",
    mechanism: ["给正式数据库创建快照", "从快照 Clone 出独立候选库", "在候选库里跑坏数据注入、质量校验与修复"],
    sql: "CREATE SNAPSHOT demo_promo_base FOR DATABASE demo_shop;\nCREATE DATABASE demo_shop_ci CLONE demo_shop {snapshot='demo_promo_base'};\nSELECT COUNT(*) FROM demo_shop.orders;\nSELECT COUNT(*) FROM demo_shop_ci.orders;",
    steps: ["clone", "ci"], evidence: [["source_rows", "源库订单"], ["clone_rows", "候选库订单"], ["clone_ms", "本次 Clone 耗时", " ms"], ["candidate_price", "候选库验证价格"]],
    visual: "clone", tone: "teal",
  },
  {
    id: "vector", tag: "重点 02", title: "向量检索", subtitle: "用相近意图找到商品",
    summary: "把向量放在业务表中，用 SQL 建索引、计算距离并排序；搜索结果仍能与价格、库存一起读取。",
    value: "关键词表达不完整时，用户仍希望找到与场景相近的商品。",
    mechanism: ["给商品保存演示用的 4 维向量", "建立 IVFFLAT 向量索引", "按 L2 距离排序并同时读取库存与价格"],
    sql: "CREATE INDEX vec_products USING IVFFLAT ON demo_shop_ci.products(embedding)\n  LISTS=3 OP_TYPE 'vector_l2_ops';\nSELECT name, price, stock,\n       L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') AS distance\nFROM demo_shop_ci.products\nORDER BY distance LIMIT 5;",
    steps: ["search"], evidence: [["vector_hits", "向量查询返回"]], visual: "search", tone: "violet",
    note: "演示向量是预先生成的 4 维数据，用于展示数据库检索流程；页面没有调用外部嵌入模型。",
  },
  {
    id: "fulltext", tag: "重点 03", title: "全文检索", subtitle: "商品描述与文档统一查询",
    summary: "给商品名称和描述建立全文索引，也让 Stage 中的 DOCX 说明书通过 DATALINK 参与检索。",
    value: "开发者希望从商品结构化字段和文档正文中找到同一业务答案。",
    mechanism: ["建立商品名称与描述的全文索引", "使用 MATCH AGAINST 查询关键词", "用 DATALINK 指向 Stage 中的 DOCX 并查询正文"],
    sql: "CREATE FULLTEXT INDEX ft_products ON demo_shop_ci.products(name,description);\nSELECT name FROM demo_shop_ci.products\nWHERE MATCH(name,description) AGAINST('charger');\nSELECT product_id FROM demo_shop_ci.product_docs\nWHERE MATCH(manual) AGAINST('warranty');",
    steps: ["search"], evidence: [["keyword_hits", "自然语言命中"], ["boolean_hits", "布尔命中"], ["json_hits", "JSON 命中"], ["document_hits", "说明书命中"]], visual: "search", tone: "teal",
  },
  {
    id: "ingest", tag: "数据入口", title: "Stage · 外表 · SQL Task", subtitle: "文件先可查，再可控地入库",
    summary: "Stage 命名文件目录，外表读取 CSV；质量表单独留痕，再创建 SQL Task 导入有效商品。",
    value: "供应商文件到达后，先检查质量，再交给业务表使用。",
    mechanism: ["生成 CSV 与 DOCX 材料", "Stage 和外表读取原始 7 行，单独记录 1 行异常", "创建并执行 SQL Task 导入 6 行有效商品"],
    sql: "USE demo_ingest;\nCREATE STAGE demo_supplier URL='file://<本地材料目录>/';\nCREATE EXTERNAL TABLE supplier_feed (product_id BIGINT, sku VARCHAR(40), name VARCHAR(120), description TEXT, category VARCHAR(40), price DECIMAL(10,2), stock INT)\n  INFILE{'filepath'='stage://demo_supplier/products.csv','format'='csv'} FIELDS TERMINATED BY ',' IGNORE 1 LINES;\nSELECT COUNT(*) FROM supplier_feed;",
    steps: ["prepare", "schema", "ingest"], evidence: [["external_rows", "外表读取"], ["rejected_rows", "质量异常"], ["products", "有效商品"], ["orders", "订单基线"]], visual: "ingest", tone: "teal",
  },
  {
    id: "htap", tag: "实时业务", title: "HTAP", subtitle: "交易提交后立即分析",
    summary: "下单、扣库存和汇总查询使用同一份数据；页面可继续提交订单，观察销售指标变化。",
    value: "业务希望看到刚发生的订单，不想等待另一套分析链路完成同步。",
    mechanism: ["在事务中扣库存并写入订单", "提交后查询订单数与销售总额", "在实验台继续下单并观察指标"],
    sql: "START TRANSACTION;\nUPDATE demo_shop.products SET stock=stock-1 WHERE product_id=1;\nINSERT INTO demo_shop.orders VALUES (<新订单号>,1,1,<成交金额>,CURRENT_TIMESTAMP());\nCOMMIT;\nSELECT COUNT(*), SUM(amount) FROM demo_shop.orders;",
    steps: ["operate"], evidence: [["live_orders", "当前订单"], ["revenue", "销售总额", "¥"]], visual: "htap", tone: "violet",
  },
  {
    id: "recovery", tag: "数据安全", title: "PITR · 误删恢复", subtitle: "回到事故前，让误删的数据回来",
    summary: "预先开启 PITR，误删后按事故前时间点找回表和数据；逐列核对价格，并与命名快照恢复作对照。",
    value: "事故恢复要证明数据回来了，而不是只看到一条成功提示。",
    mechanism: ["预先开启 PITR 并记录正常业务时间点", "误删表，查询确认表不存在", "按事故前时间恢复，逐列核对六件商品"],
    sql: "CREATE SNAPSHOT demo_before_accident FOR DATABASE demo_shop;\nDROP TABLE demo_shop.promo_kpis;\nRESTORE TABLE demo_shop.promo_kpis{snapshot=\"demo_before_accident\"};\nSELECT metric, metric_value FROM demo_shop.promo_kpis;",
    steps: ["recover"], evidence: [["pitr_rows", "恢复商品行数"], ["pitr_status", "恢复状态"]], visual: "recovery", tone: "violet",
  },
  {
    id: "pubsub", tag: "跨账号共享", title: "Publish / Subscribe", subtitle: "让合作伙伴订阅商品目录",
    summary: "发布方创建 Publication；另一个账号创建订阅数据库，直接查询经过发布的商品。",
    value: "跨团队协作时，需要可控共享，不必为每个使用方维护一份数据副本。",
    mechanism: ["创建独立合作伙伴账号", "发布 demo_shop 的 products 表", "订阅端查询商品数量"],
    sql: "CREATE PUBLICATION demo_catalog DATABASE demo_shop TABLE products\n  ACCOUNT demo_partner;\nCREATE DATABASE partner_catalog FROM sys PUBLICATION demo_catalog;\nSELECT COUNT(*) FROM partner_catalog.products;",
    steps: ["pubsub"], evidence: [["subscribed_products", "订阅端商品"]], visual: "share", tone: "teal",
  },
  {
    id: "iceberg", tag: "开放湖表", title: "Iceberg", subtitle: "从空湖表到 SQL 读写与历史对照",
    summary: "从服务准备、REST 建湖表、Catalog 注册和外表映射开始，再写入订单，观察文件、快照与历史分支。",
    value: "开放格式的数据需要在同一 SQL 入口下查询，也需要对照历史状态。",
    mechanism: ["启动存储与 Catalog，创建空湖表", "注册访问并映射，写入四笔订单", "保存历史分支，再追加一笔并逐行比较"],
    sql: "SELECT COUNT(*), SUM(amount)\nFROM demo_story_lake.append_orders;\nSELECT COUNT(*), SUM(amount)\nFROM demo_story_lake.append_orders_old;",
    steps: ["iceberg"], evidence: [["iceberg_current_rows", "当前快照"], ["iceberg_history_rows", "历史快照"]], visual: "iceberg", tone: "violet",
  },
  {
    id: "cdc", tag: "增量同步", title: "CDC", subtitle: "新订单到达 MySQL",
    summary: "创建增量任务，在 MatrixOne 写入订单后，到独立 MySQL 目标端按同一订单号验证。",
    value: "需要把数据库变更持续交付给其他系统，而不是手工定期导出。",
    mechanism: ["准备 3 小时 PITR 配置和 MySQL 目标端", "建立只同步增量的 CDC 任务", "等待检查点后下单并在两端查询"],
    sql: "CREATE PITR demo_cdc_pitr FOR DATABASE demo_shop RANGE 3 'h';\nCREATE CDC demo_orders_cdc 'mysql://<MatrixOne 连接>' 'mysql' 'mysql://<MySQL 连接>' 'demo_shop.orders:demo_sink.orders' {'Level'='table','NoFull'='true'};\n-- 在独立 MySQL 目标端查询\nSELECT COUNT(*) FROM demo_sink.orders WHERE order_id=<新订单号>;",
    steps: ["cdc"], evidence: [["cdc_order_id", "同步的订单号", "#"], ["cdc_target_rows", "MySQL 目标端命中"]], visual: "cdc", tone: "teal",
  },
];

const SCHEMA_STEP_SQL = `CREATE DATABASE demo_ingest;
CREATE DATABASE demo_shop;
USE demo_ingest;
CREATE STAGE demo_supplier URL='file://<本地材料目录>/';
CREATE EXTERNAL TABLE supplier_feed (
  product_id BIGINT, sku VARCHAR(40), name VARCHAR(120),
  description TEXT, category VARCHAR(40),
  price DECIMAL(10,2), stock INT
) INFILE{'filepath'='stage://demo_supplier/products.csv','format'='csv'}
FIELDS TERMINATED BY ',' IGNORE 1 LINES;
CREATE TABLE quality_issues(product_id BIGINT PRIMARY KEY,issue VARCHAR(80));
INSERT INTO quality_issues
SELECT product_id,'price or stock is invalid'
FROM supplier_feed WHERE price<=0 OR stock<0;
USE demo_shop;
CREATE TABLE products (
  product_id BIGINT PRIMARY KEY,sku VARCHAR(40),name VARCHAR(120),
  description TEXT,category VARCHAR(40),price DECIMAL(10,2),
  stock INT,embedding VECF32(4)
);
CREATE TABLE orders (
  order_id BIGINT PRIMARY KEY,product_id BIGINT,qty INT,
  amount DECIMAL(12,2),created_at DATETIME
);
CREATE TABLE product_docs (
  doc_id BIGINT PRIMARY KEY,product_id BIGINT,manual DATALINK,
  FULLTEXT(manual)
);
SELECT COUNT(*) FROM demo_ingest.supplier_feed; -- 7
SELECT product_id,issue FROM demo_ingest.quality_issues; -- #7
SELECT COUNT(*) FROM demo_shop.products; -- 0`;
const TASK_STEP_SQL = `USE demo_ingest;
-- 先定义任务：DELIMITER 是 mysql 客户端指令
DELIMITER //
CREATE TASK demo_load_catalog AS BEGIN
  INSERT INTO demo_shop.products
    (product_id,sku,name,description,category,price,stock)
  SELECT f.product_id,f.sku,f.name,f.description,f.category,f.price,f.stock
  FROM demo_ingest.supplier_feed f
  WHERE f.price>0 AND f.stock>=0
    AND NOT EXISTS (SELECT 1 FROM demo_shop.products p
                    WHERE p.product_id=f.product_id);
END//
DELIMITER ;
-- 再手动触发，并查询真正的运行结果
EXECUTE TASK demo_load_catalog;
SHOW TASK RUNS FOR demo_load_catalog LIMIT 1;
SELECT COUNT(*) FROM demo_shop.products; -- 6
-- 以下准备均在 Task 之外：六件商品写入预置四维向量
UPDATE demo_shop.products SET embedding='[0.98,0.06,0.02,0.00]' WHERE product_id=1;
UPDATE demo_shop.products SET embedding='[0.88,0.15,0.03,0.00]' WHERE product_id=2;
UPDATE demo_shop.products SET embedding='[0.05,0.95,0.05,0.00]' WHERE product_id=3;
UPDATE demo_shop.products SET embedding='[0.10,0.05,0.95,0.00]' WHERE product_id=4;
UPDATE demo_shop.products SET embedding='[0.02,0.02,0.05,0.98]' WHERE product_id=5;
UPDATE demo_shop.products SET embedding='[0.89,0.09,0.02,0.00]' WHERE product_id=6;
INSERT INTO demo_shop.product_docs VALUES
  (1,1,'stage://demo_supplier/travel_charger.docx');
-- 再独立造出用于大表 Clone 的订单基线
INSERT INTO demo_shop.orders
SELECT result,1+(result%6),1,99.00,'2026-09-01 10:00:00'
FROM generate_series(1,1000000) g;
SELECT COUNT(*) FROM demo_shop.orders;`;
const CLONE_STEP_SQL = `CREATE SNAPSHOT demo_promo_base FOR DATABASE demo_shop;
CREATE DATABASE demo_shop_ci CLONE demo_shop {snapshot='demo_promo_base'};
SELECT COUNT(*) FROM demo_shop.orders;
SELECT COUNT(*) FROM demo_shop_ci.orders;`;
const CI_STEP_SQL = `-- 候选库里故意写坏，只用于验证门禁
UPDATE demo_shop_ci.products SET price=-1 WHERE product_id=1;
SELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0; -- FAIL: 1
-- 修复候选库，再确认源库没有被改动
UPDATE demo_shop_ci.products SET price=269.10 WHERE product_id=1;
SELECT COUNT(*) FROM demo_shop_ci.products WHERE price<=0 OR stock<0; -- PASS: 0
SELECT price FROM demo_shop.products WHERE product_id=1;
SELECT price FROM demo_shop_ci.products WHERE product_id=1;`;
const SEARCH_STEP_SQL = `CREATE FULLTEXT INDEX ft_products ON demo_shop_ci.products(name,description);
CREATE TABLE IF NOT EXISTS demo_shop_ci.product_specs(product_id BIGINT PRIMARY KEY,details JSON);
INSERT IGNORE INTO demo_shop_ci.product_specs VALUES
  (1,'{"technology":"GaN","ports":"USB-C"}'),
  (2,'{"technology":"adapter","ports":"AC"}'),
  (3,'{"technology":"battery","ports":"USB-C"}');
CREATE FULLTEXT INDEX ft_specs ON demo_shop_ci.product_specs(details) WITH PARSER json;
CREATE INDEX vec_products USING IVFFLAT ON demo_shop_ci.products(embedding)
  LISTS=3 OP_TYPE 'vector_l2_ops';
SELECT product_id FROM demo_shop_ci.products
  WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE);
SELECT product_id FROM demo_shop_ci.products
  WHERE MATCH(name,description) AGAINST('+charger' IN BOOLEAN MODE);
SELECT product_id FROM demo_shop_ci.product_specs
  WHERE MATCH(details) AGAINST('GaN');
SELECT product_id FROM demo_shop_ci.products
  ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5;
SELECT product_id FROM demo_shop_ci.product_docs
  WHERE MATCH(manual) AGAINST('warranty');`;
const RELEASE_STEP_SQL = `SELECT price FROM demo_shop_ci.products WHERE product_id=1; -- 已验收价格 269.10
UPDATE demo_shop.products SET price=269.10 WHERE product_id=1;
CREATE FULLTEXT INDEX ft_products ON demo_shop.products(name,description);
CREATE INDEX vec_products USING IVFFLAT ON demo_shop.products(embedding)
  LISTS=3 OP_TYPE 'vector_l2_ops';
SELECT price FROM demo_shop.products WHERE product_id=1;`;
const OPERATE_STEP_SQL = `-- 新订单号与成交金额由本地脚本读取库存和价格后填入
START TRANSACTION;
UPDATE demo_shop.products SET stock=stock-1 WHERE product_id=1;
INSERT INTO demo_shop.orders VALUES (<新订单号>,1,1,<成交金额>,CURRENT_TIMESTAMP());
COMMIT;
SELECT COUNT(*),COALESCE(SUM(amount),0) FROM demo_shop.orders;`;
const RECOVER_STEP_SQL = `-- 提前开启一小时 PITR，正常写入后再模拟事故
CREATE DATABASE demo_pitr_shop;
CREATE PITR demo_price_history FOR DATABASE demo_pitr_shop RANGE 1 'h';
CREATE TABLE demo_pitr_shop.prices(product_id BIGINT PRIMARY KEY,name VARCHAR(120),price DECIMAL(10,2));
INSERT INTO demo_pitr_shop.prices SELECT product_id,name,price FROM demo_shop.products;
SHOW PITR WHERE pitr_name='demo_price_history';
-- 跨过秒边界，记录服务器本地时间 T1
SELECT NOW();
UPDATE demo_pitr_shop.prices SET price=0;
-- 跨过秒边界，记录零价时间 T2
SELECT NOW();
DROP TABLE demo_pitr_shop.prices;
SELECT COUNT(*) FROM demo_pitr_shop.prices; -- 预期报错
-- 脚本代入真实 T1，恢复正常价格
RESTORE DATABASE demo_pitr_shop FROM PITR demo_price_history '<T1: YYYY-MM-DD HH:MM:SS>';
SELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id;`;
const PUBSUB_STEP_SQL = `CREATE ACCOUNT demo_partner ADMIN_NAME 'admin' IDENTIFIED BY '<本地演示密码>';
CREATE PUBLICATION demo_catalog DATABASE demo_shop TABLE products ACCOUNT demo_partner;
-- 以下使用 demo_partner:admin 账号连接
CREATE DATABASE partner_catalog FROM sys PUBLICATION demo_catalog;
SELECT COUNT(*) FROM partner_catalog.products;`;
const ICEBERG_STEP_SQL = `-- 前两步在 SQL 之外：启动 MinIO/Nessie，用 REST API 创建 namespace 与空湖表。
-- 上方逐步操作展示完整 Shell / REST 请求及实际返回。
CREATE DATABASE demo_story_lake;
CREATE ICEBERG CATALOG IF NOT EXISTS demo_story_ice WITH (
  'type'='rest','uri'='http://127.0.0.1:19120/iceberg',
  'warehouse'='s3://mo-iceberg/warehouse','auth_mode'='none');
CALL iceberg_register_access('demo_story_ice',
  'scope=cluster,account_id=0,external_principal=ci-local,endpoint=localhost,region=us-east-1,bucket=mo-iceberg');
CREATE EXTERNAL TABLE demo_story_lake.append_orders (
  order_id BIGINT,bucket INT,amount BIGINT,region TEXT
) ENGINE=ICEBERG WITH (
  'catalog'='demo_story_ice','namespace'='<本次 namespace>',
  'table'='append_orders','ref'='main',
  'read_mode'='append_only','write_mode'='append_only');
SHOW CREATE TABLE demo_story_lake.append_orders;
-- 新空湖表尚无数据快照；先写入再查询
INSERT INTO demo_story_lake.append_orders VALUES
  (1,1,10,'ksa'),(2,1,20,'uae'),(3,2,30,'ksa'),(4,2,40,'qat');
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;
-- 此时通过 Nessie API 从 main 的提交创建历史分支，并记录 Iceberg snapshot ID。
CREATE EXTERNAL TABLE demo_story_lake.append_orders_old (
  order_id BIGINT,bucket INT,amount BIGINT,region TEXT
) ENGINE=ICEBERG WITH (
  'catalog'='demo_story_ice','namespace'='<本次 namespace>',
  'table'='append_orders','ref'='<历史 Nessie 分支名>',
  'read_mode'='append_only','write_mode'='append_only');
INSERT INTO demo_story_lake.append_orders VALUES (5,3,50,'ksa');
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders_old
FOR ICEBERG SNAPSHOT <四行时的 snapshot ID>;`;
const CDC_STEP_SQL = `-- 本地先启动 MySQL 目标端；连接信息由演示服务填入
CREATE PITR demo_cdc_pitr FOR DATABASE demo_shop RANGE 3 'h';
CREATE CDC demo_orders_cdc
  'mysql://<MatrixOne 连接>' 'mysql' 'mysql://<MySQL 连接>'
  'demo_shop.orders:demo_sink.orders' {'Level'='table','NoFull'='true'};
SHOW CDC ALL;
-- 等待初始检查点后，向 MatrixOne 写入一条新订单
SELECT COUNT(*) FROM demo_shop.orders WHERE order_id=<本次新订单号>;
-- 以下 SQL 在独立 MySQL 目标端执行
SELECT COUNT(*) FROM demo_sink.orders WHERE order_id=<本次新订单号>;`;

export const STEPS = [
  {id: "start", title: "启动 MatrixOne v4.2.4", act: 0, capability: "ingest", why: "先确认所有后续 SQL 都运行在固定版本上。", action: "准备 release 工作区，启动独立服务，并查询版本。", expected: "版本返回 v4.2.4，端口为 16042。", sql: "SELECT VERSION();", keys: [["mo_version", "服务版本"], ["mo_port", "本地端口"]]},
  {id: "prepare", title: "准备供应商材料", act: 0, capability: "ingest", why: "业务从有瑕疵的外部材料开始。", action: "生成 7 行 CSV 和一份 DOCX 商品说明书。", expected: "一行价格无效，下一步会被质量规则识别。", sql: "-- 生成 products.csv 与 travel_charger.docx\n-- 之后通过 Stage 读取", keys: [["supplier_rows", "CSV 原始行数"]]},
  {id: "schema", title: "Stage 与外表读取", act: 0, capability: "ingest", why: "先建立路径与 CSV 映射，查询原始行并单独记录异常；此时不导入商品。", action: "创建 Stage、外表和质量表，读取 CSV 七行并将负价商品写入质量表。", expected: "外表 7 行，质量表 1 行，业务商品表仍为空。", sql: SCHEMA_STEP_SQL, keys: [["external_rows", "外表原始行"], ["rejected_rows", "已记录异常"]]},
  {id: "ingest", title: "SQL Task 清洗入库", act: 0, capability: "ingest", why: "先把有效商品的 INSERT ... SELECT 定义为具名任务，再手动触发并核对运行史。", action: "创建并运行 demo_load_catalog 导入六件商品；脚本随后单独补向量、文档引用和百万行订单。", expected: "Task SUCCESS、影响 6 行商品；向量、文档和订单由任务外语句准备。", sql: TASK_STEP_SQL, keys: [["task_status", "Task 状态"], ["products", "已入库商品"], ["orders", "独立生成订单"]]},
  {id: "clone", title: "百万行大表 Clone", act: 1, capability: "git4data", why: "在真实规模上做 CI 和测试，并保持正式库不受测试写入影响。", action: "给正式库建快照，并创建独立候选库，再查询两边行数。", expected: "源库与 Clone 各 100 万行，并显示本次耗时。", sql: CLONE_STEP_SQL, keys: [["source_rows", "源库订单"], ["clone_rows", "Clone 订单"], ["clone_ms", "创建耗时", " ms"]]},
  {id: "ci", title: "候选库 CI 门禁", act: 1, capability: "git4data", why: "变更必须在隔离环境中证明正确。", action: "故意写入负价，发现 1 行错误，再修复并验证正式库不变。", expected: "CI 从 FAIL 变为 PASS；源库仍为 299.00。", sql: CI_STEP_SQL, keys: [["ci_failed_rows", "最终失败行"], ["source_price", "源库价格"], ["candidate_price", "候选价格"]]},
  {id: "search", title: "全文、向量与文档检索", act: 1, capability: "vector", why: "同一商品目录支持自然语言、布尔、JSON、意图向量和说明书正文查询。", action: "建立全文与 IVF 向量索引，分别运行五类检索。", expected: "显示五类检索各自的真实命中数量。", sql: SEARCH_STEP_SQL, keys: [["keyword_hits", "自然语言"], ["boolean_hits", "布尔模式"], ["json_hits", "JSON 全文"], ["vector_hits", "向量返回"], ["document_hits", "说明书"]]},
  {id: "release", title: "验证通过后上线", act: 1, capability: "fulltext", why: "只有候选环境验证通过的价格与索引才进入正式库。", action: "读取候选库已验收价格，显式更新正式库并建立搜索索引。", expected: "正式价为 269.10，索引可用。", sql: RELEASE_STEP_SQL, keys: [["live_price", "正式商品价格"]]},
  {id: "operate", title: "HTAP 下单与分析", act: 2, capability: "htap", why: "交易发生后，报表立即从同一份数据读取新结果。", action: "在事务中扣库存、写订单，提交后重新计算订单数与销售额。", expected: "订单数加 1，销售额同步增加。", sql: OPERATE_STEP_SQL, keys: [["live_orders", "当前订单"], ["revenue", "销售额", "¥"]]},
  {id: "recover", title: "PITR 误删表恢复", act: 2, capability: "recovery", why: "事故恢复必须用真实删除和逐项数据校验来证明。", action: "提前为价格库开启一小时 PITR，写入六件商品；误改并误删表，确认查询失败，再按正常时间点恢复。", expected: "DROP 后查询失败；PITR 找回六件商品，名称与价格逐列匹配事故前记录。", sql: RECOVER_STEP_SQL, keys: [["pitr_rows", "恢复商品行数"], ["pitr_status", "恢复状态"]]},
  {id: "pubsub", title: "发布与订阅", act: 3, capability: "pubsub", why: "合作伙伴需要按账号直接使用已发布的目录。", action: "创建伙伴账号和 Publication，再以伙伴身份创建订阅库并查询。", expected: "订阅端读取 6 件商品。", sql: PUBSUB_STEP_SQL, keys: [["subscribed_products", "订阅端商品"]]},
  {id: "iceberg", title: "Iceberg 从建表到读写", act: 3, capability: "iceberg", why: "开放湖表也能从 SQL 入口查询，并对照历史快照。", action: "启动服务，REST 建湖表；注册 Catalog 并映射，写四行，保存历史分支，再追加一行并核对。", expected: "当前 5 行/150，历史 4 行/100。", sql: ICEBERG_STEP_SQL, keys: [["iceberg_current_rows", "当前行数"], ["iceberg_history_rows", "历史行数"]]},
  {id: "cdc", title: "CDC 增量到 MySQL", act: 3, capability: "cdc", why: "把新的订单变更持续交给另一系统。", action: "准备 PITR 与 MySQL 目标端，建立 CDC 并等待检查点；写入新订单后两端查询。", expected: "MatrixOne 与 MySQL 都找到这条订单。", sql: CDC_STEP_SQL, keys: [["cdc_order_id", "新订单号", "#"], ["cdc_target_rows", "目标端命中"]]},
];

export const STEP_IDS = STEPS.map((step) => step.id);
export const getCapability = (id) => CAPABILITIES.find((item) => item.id === id);
export const getStep = (id) => STEPS.find((item) => item.id === id);
export const nextIncomplete = (state) => STEPS.find((step) => !(state.completed || []).includes(step.id));

// 每条核对查询均由 /api/check 在本机真正执行；这里的 SQL 是运行前预览。
export const CHECKS = {
  start: [{id:'version',label:'确认服务版本',sql:'SELECT VERSION();'}],
  prepare: [],
  schema: [
    {id:'stage_list',label:'Stage 指向哪里？',sql:'SHOW STAGES;'},
    {id:'external_rows',label:'外表读取几行？',sql:'SELECT COUNT(*) AS rows FROM demo_ingest.supplier_feed;'},
    {id:'external_sample',label:'CSV 原始行与负价',sql:'SELECT product_id,name,price,stock FROM demo_ingest.supplier_feed ORDER BY product_id;'},
    {id:'quality_rows',label:'质量表记录了谁？',sql:'SELECT product_id, issue FROM demo_ingest.quality_issues ORDER BY product_id LIMIT 5;'},
  ],
  ingest: [
    {id:'task_runs',label:'Task 运行史',sql:"SELECT run_id,trigger_type,status,rows_affected FROM mo_task.sql_task_run WHERE task_name='demo_load_catalog' ORDER BY run_id DESC LIMIT 1;"},
    {id:'products',label:'清洗后的商品',sql:'SELECT product_id, name, price FROM demo_shop.products ORDER BY product_id LIMIT 6;'},
    {id:'order_count',label:'订单基线行数',sql:'SELECT COUNT(*) AS orders FROM demo_shop.orders;'},
  ],
  clone: [
    {id:'source_count',label:'查询正式库行数',sql:'SELECT COUNT(*) AS orders FROM demo_shop.orders;'},
    {id:'clone_count',label:'查询候选库行数',sql:'SELECT COUNT(*) AS orders FROM demo_shop_ci.orders;'},
  ],
  ci: [{id:'ci_prices',label:'对照两库价格',sql:"SELECT 'source' AS library, price FROM demo_shop.products WHERE product_id=1 UNION ALL SELECT 'candidate', price FROM demo_shop_ci.products WHERE product_id=1;"}],
  search: [
    {id:'keyword',label:'全文命中商品',sql:"SELECT product_id, name, price, stock, MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AS score FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) ORDER BY score DESC, product_id LIMIT 8;"},
    {id:'fulltext_tfidf',label:'评分 · TF-IDF',sql:"SET ft_relevancy_algorithm='TF-IDF'; SELECT product_id, MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AS score FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) ORDER BY score DESC;",fixed:true},
    {id:'fulltext_bm25',label:'评分 · BM25',sql:"SET ft_relevancy_algorithm='BM25'; SELECT product_id, MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AS score FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) ORDER BY score DESC;",fixed:true},
    {id:'boolean',label:'布尔检索：必须包含 charger',sql:"SELECT product_id, name FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('+charger' IN BOOLEAN MODE) ORDER BY product_id LIMIT 8;"},
    {id:'json_spec',label:'JSON 字段全文检索',sql:"SELECT product_id FROM demo_shop_ci.product_specs WHERE MATCH(details) AGAINST('GaN') ORDER BY product_id;"},
    {id:'vector',label:'向量距离排序',sql:"SELECT product_id, name, price, stock, ROUND(L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]'),3) FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5;"},
    {id:'vector_probe',label:'nprobe=2 · 扫描中心',sql:"SELECT product_id, name FROM demo_shop_ci.products ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5 BY RANK WITH OPTION 'nprobe=2';",fixed:true},
    {id:'vector_plan',label:'EXPLAIN · IVF 路径',sql:"EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5;",fixed:true},
    {id:'vector_plan_pre',label:'EXPLAIN · pre 过滤',sql:"EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5 BY RANK WITH OPTION 'mode=pre';",fixed:true},
    {id:'hybrid',label:'全文 + 向量 + 库存过滤',sql:"SELECT product_id,name,price,stock FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE) AND stock>0 ORDER BY L2_DISTANCE(embedding,'[0.95,0.08,0.02,0.00]') LIMIT 5;"},
    {id:'fulltext_plan',label:'EXPLAIN · 全文索引',sql:"EXPLAIN SELECT product_id, name FROM demo_shop_ci.products WHERE MATCH(name,description) AGAINST('charger' IN NATURAL LANGUAGE MODE);",fixed:true},
    {id:'document',label:'说明书正文命中',sql:"SELECT product_id FROM demo_shop_ci.product_docs WHERE MATCH(manual) AGAINST('warranty');"},
  ],
  release: [{id:'live_price',label:'查询正式价格',sql:'SELECT product_id, name, price FROM demo_shop.products WHERE product_id=1;'}],
  operate: [{id:'live_report',label:'查询即时汇总',sql:'SELECT COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue FROM demo_shop.orders;'}],
  recover: [{id:'pitr_policy',label:'查询 PITR 保留策略',sql:"SHOW PITR WHERE pitr_name='demo_price_history';",fixed:true},{id:'pitr_prices',label:'核对 PITR 恢复价格',sql:'SELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id;'}],
  pubsub: [{id:'subscriber',label:'用订阅账号读取目录',sql:'SELECT product_id, name, price FROM partner_catalog.products ORDER BY product_id LIMIT 6;'}],
  iceberg: [
    {id:'iceberg_current',label:'当前快照',sql:'SELECT COUNT(*), SUM(amount) FROM demo_story_lake.append_orders;'},
    {id:'iceberg_history',label:'历史快照',sql:'SELECT COUNT(*), SUM(amount) FROM demo_story_lake.append_orders_old;'},
  ],
  cdc: [
    {id:'cdc_source',label:'MatrixOne 源端',sql:'SELECT COUNT(*) FROM demo_shop.orders WHERE order_id=<本次新订单号>;' },
    {id:'cdc_sink',label:'MySQL 目标端',sql:'SELECT COUNT(*) FROM demo_sink.orders WHERE order_id=<本次新订单号>;' },
  ],
};

export const STORY = {
  start: {scene:'场景开始 · 确认运行环境',body:'你负责给一家电商商城上线新的搜索能力。所有后续证据必须来自同一版本的数据库，因此先确定运行环境。本演示会从 v4.2.4 release 构建独立服务，再用 SQL 核对版本。',next:'服务就绪后，先接收供应商交来的商品与说明书。'},
  prepare: {scene:'供应商交付 · 原始材料并不完美',body:'商品团队给了一个 CSV 和一份 DOCX 说明书。CSV 有 7 行，其中一行价格为负。我们保留这条坏数据，让后面的数据质量检查有真实对象。',next:'文件准备好后，先直接查询原始文件，不急着写入业务表。'},
  schema: {scene:'先让文件可查，再决定如何处理',body:'Stage 只是命名文件目录；外表告诉数据库如何按七列读取 products.csv。查询确认七行中有一个负价，再明确执行 INSERT ... SELECT 把异常记录进质量表。此时业务商品表还没有导入。',next:'原始文件与质量结果已经核对，下一章创建具名 SQL Task 导入六件有效商品。'},
  ingest: {scene:'把可解释的规则保存为任务',body:'CREATE TASK demo_load_catalog 保存一段 INSERT ... SELECT；EXECUTE TASK 按名称手动触发。运行史证明任务成功并写入六件商品。预置向量、DOCX 引用和百万行订单随后由脚本单独写入。',next:'商品与订单基线都已准备好，可以验证大表快照与 Clone。'},
  clone: {scene:'开发与测试 · 大表也要进 CI',body:'搜索升级需要在真实规模上验证，但测试不能修改正式库。给正式库打快照，再 Clone 出候选库；分别查询两边的订单行数，并记录本次 Clone 的实际耗时。',next:'候选库已经独立，可以故意注入错误来检验质量门禁。'},
  ci: {scene:'CI 门禁 · 故意制造一次失败',body:'把候选库一件商品改成负价，质量检查必须报错。随后修复候选库，并分别读取正式库与候选库的价格，证明测试写入没有污染正式数据。',next:'通过数据验证后，在候选库里开发全文与向量搜索。'},
  search: {scene:'搜索升级 · 三种不同的召回',body:'商品描述适合全文检索，场景意图适合向量距离排序，说明书正文通过 Stage 和 DATALINK 进入搜索。三类查询读取同一份候选商品目录，并展示各自的命中行。',next:'搜索和价格都经过验证，再把确定的变更应用到正式库。'},
  release: {scene:'上线 · 只交付已验证的变更',body:'候选库的验证结果不是自动合并指令。演示明确读取通过验收的价格，再在正式库应用这项变更并创建搜索索引，最后重新查询正式价。',next:'版本上线后，看看交易发生时分析查询能否立即看到它。'},
  operate: {scene:'营业中 · 交易与分析使用同一份数据',body:'用户购买一件商品。事务中扣库存、写订单；提交后立刻查询订单总数与销售额。实验台还可以继续下单，观察结果同步变化。',next:'业务有了报表，也就需要回答误删后的恢复问题。'},
  recover: {scene:'价格表误删了，回到事故前',body:'日常写入之前先为独立价格库开启 PITR。商品被批量误改后又误删，查询确认表不存在；选择误改前的服务器时间恢复数据库，再逐列核对六件商品。下方时间线可验证：选到误改后的时刻，会恢复出零价。',next:'确认商品数据恢复正确后，再继续跨账号共享。'},
  pubsub: {scene:'合作伙伴 · 共享而不复制目录',body:'发布方创建 Publication，合作伙伴在独立账号里创建订阅数据库。我们使用订阅账号执行查询，验证它确实能读到商品目录。',next:'除了账号共享，还要看到开放湖表的当前和历史状态。'},
  iceberg: {scene:'订单归档进入开放湖表',body:'先有存储和表目录，再通过 REST 创建湖表。MatrixOne 注册 Catalog 与访问范围，映射后写入四笔订单；保留历史分支，再追加第五笔。用真实行、快照 ID 和文件路径解释每一步的结果。',next:'最后用 CDC 把新增订单持续交付到独立 MySQL。'},
  cdc: {scene:'增量交付 · 两端核对同一订单',body:'创建 CDC 任务后，向 MatrixOne 写入一条新订单。等同步推进，再用同一订单号分别查询 MatrixOne 源端和独立 MySQL 目标端。',next:'至此，从文件入口、开发验证、在线业务到外部交付的路径已经走完。'},
};

export const GUIDES = {
  git4data: {
    context:'上线前要在真实订单规模上测试折扣与搜索变更。演示先造出 100 万行订单，再为正式库建快照、Clone 候选库。候选库中故意注入负价并修复，正式库价格在整个 CI 过程中保持不变。',
    terms:[['Snapshot','为当前数据库状态命名，后续 Clone 和恢复都能引用它。'],['Clone','创建独立数据库元数据并共享既有数据块；候选库可独立写入。'],['增量写入与 CI','候选库变更形成新状态；质量检查失败时拦下变更，源库继续服务。']],
    observe:'Clone 完成时，源库和候选库各记录 100 万行；之后的下单和 CDC 步骤会继续增加源库行数，候选库仍保留 Clone 时的基线。再比较两边商品价格，确认 CI 修改被隔离。Clone 耗时取自本机执行。',
    caution:'Clone 不会逐行复制既有百万行，但元数据和后续写入仍消耗空间。本页记录行数与耗时，不把逻辑表大小当作共享物理存储的实测值。正式库变更由后续步骤显式应用；Data Branch 的 DIFF / MERGE 是另一组操作。',
  },
  vector: {
    context:'用户输入的是“旅行充电”这样的意图，而不是商品标题中的完整关键词。商品表保存 4 维演示向量；SQL 对查询向量计算 L2 距离，再按距离从近到远排序。',
    terms:[['VECF32(4)','商品向量列，四个数值在本演示中预先生成。'],['IVFFLAT / LISTS','基于已有向量训练中心并分组；商品示例用 3 个 LISTS，健康实验用 16 / 32。'],['L2_DISTANCE / OP_TYPE','L2 距离越小越近，索引算子类型须与查询距离匹配。']],
    observe:'执行核对 SQL 后，结果表列出商品、价格、库存和 distance；EXPLAIN 可检查计划里是否出现 ivf_search。pre 过滤计划与普通 Top-K 计划可以并排比较。',
    caution:'演示没有调用外部嵌入模型。商品表只有 6 个预生成向量，适合验证 SQL 路径，不适合判断生产召回。健康实验另建 1200 行索引样本；中心负载只是诊断线索，还要结合延迟和召回。',
  },
  fulltext: {
    context:'客服要找商品描述中提到 charger 的产品，也要从 DOCX 说明书正文找到 warranty。商品文本和 Stage 中的文档都通过 SQL 检索。',
    terms:[['FULLTEXT INDEX / parser','为文本建立倒排入口；JSON 规格在本演示中使用 json parser。'],['MATCH AGAINST / score','自然语言模式可返回相关度；经典 FULLTEXT 默认 TF-IDF，也可切换 BM25。'],['DATALINK','保存指向 Stage 文件的引用，使 DOCX 正文进入单独的全文索引。']],
    observe:'自然语言、布尔、JSON 与说明书正文各自返回真实命中；商品查询可读取评分。控制台可比较 TF-IDF 与 BM25 的本机分数，EXPLAIN 应显示 fulltext_index_scan。',
    caution:'不同 parser、模式和文档来源应分别验收；两种评分的绝对值不能跨算法直接比较。经典 FULLTEXT 与 FULLTEXT2 有各自的设置和默认算法，本场景使用前者。DATALINK 文件必须可访问。',
  },
  ingest: {
    context:'供应商的七行 CSV 先留在文件目录。Stage 为目录命名，外表负责解析和查询；一行负价被单独记入质量表。随后 CREATE TASK 定义 demo_load_catalog，并手动执行，把六行有效商品导入业务表。',
    terms:[['Stage / demo_supplier','给 file:// 目录命名，供 stage:// 地址引用；不负责导入行。'],['外表 / supplier_feed','定义 CSV 列与格式，使 SELECT 能直接扫描原始文件。'],['SQL Task / demo_load_catalog','CREATE TASK 定义具名作业及 SQL 体；EXECUTE TASK 手动触发，SHOW TASK RUNS 核对结果。']],
    observe:'分别核对外表七行、质量表一行、Task 运行史 SUCCESS 与影响行数、业务商品六行。预置向量、DOCX 引用和百万行订单由任务外的 SQL 准备。',
    caution:'file:// 仅用于本机演示。多节点或云环境应使用持久、共享的对象存储 Stage。',
  },
  htap: {
    context:'交易请求扣减商品库存并写入订单。事务提交后，同一数据库立即执行 COUNT 与 SUM 聚合，页面展示订单数和销售额变化。',
    terms:[['事务','库存更新与订单写入在一次提交中完成。'],['即时聚合','提交后直接从业务表查询统计，不等待同步作业。'],['同一份数据','事务读写与分析查询基于同一套表。']],
    observe:'初始订单基线为 100 万行。演示下单后数量增加 1，实验台继续下单会让汇总再次变化。',
    caution:'这个案例验证交易后即时查询的行为；它没有给出吞吐量或生产性能基准。',
  },
  recovery: {
    context:'先为价格库开启 PITR，再让业务写入受保护的窗口。事故发生时表已不存在，依靠保留历史恢复到正常时间点；快照恢复作为旁边的可选对照。',
    terms:[['命名快照','主动保存的确定状态，恢复时指定快照名。'],['PITR 策略','预先指定保护范围与保留窗口；本例为 demo_price_history / 1 小时。'],['恢复时间点','使用窗口内的服务器本地时间；必须早于要撤销的误操作。'],['恢复范围','RESTORE DATABASE 回退整个指定库；本例只对独立价格演练库执行。']],
    observe:'删除后确认表不存在；PITR 恢复六件商品并逐列对照原始价格。选到误改后的时刻会恢复出六件零价商品。',
    caution:'PITR 必须预先启用，时间点需仍在有效窗口内。恢复按所选范围回退后续变化；行数相同还需要逐列核对业务值。',
  },
  pubsub: {
    context:'合作伙伴需要访问经过授权的商品目录。发布方创建 Publication，另一个账号订阅后在自己的数据库名称下查询商品。',
    terms:[['Publication','发布方指定要共享的数据库对象和目标账号。'],['Subscription','订阅账号创建数据库入口，读取发布数据。'],['账号边界','核对查询真正以合作伙伴账号执行。']],
    observe:'订阅账号返回 6 件商品。页面会标明这条 SQL 使用订阅账号，而不是管理员会话。',
    caution:'此演示使用本机临时账号；在其他环境应按自己的授权策略管理账号与发布范围。',
  },
  iceberg: {
    context:'从空白环境建立一张订单湖表。六步分别完成外部服务、REST 建表、MatrixOne 映射、四行写入、历史分支和第五行追加；查询由这些前置操作产生。',
    terms:[['Parquet 与对象存储','Parquet 保存订单列；MinIO bucket 存放数据文件及元数据文件。'],['Iceberg 表与快照','schema 和文件清单描述一张表；snapshot ID 标识提交后的数据状态。'],['Catalog 与 namespace','Nessie 根据 namespace/table/ref 返回表元数据。namespace 与 MatrixOne 数据库名分属两侧。'],['MatrixOne 外表映射','demo_story_lake.append_orders 保存访问关系，映射到湖上 append_orders。'],['Nessie 分支与本地别名','历史分支保留 Catalog 状态；append_orders_old 是指向该分支的本地外表名。']],
    observe:'首次 INSERT 后四行金额 100；main 再追加 #5 后五行金额 150；历史映射保持四行。快照 ID 和对象文件也能逐步核对。',
    caution:'本例已开启 Iceberg 读写并注册本地访问范围。新空湖表在本机 v4.2.4 上尚无可读快照，先 INSERT 再 SELECT。历史读取需要相关元数据和数据文件保留。',
  },
  cdc: {
    context:'订单数据还要交给独立 MySQL 系统。创建增量 CDC 任务，写入一条新订单后用相同订单号在 MatrixOne 和 MySQL 两端分别查询。',
    terms:[['PITR','为 CDC 读取变更准备保留窗口。'],['CDC Task','持续读取 MatrixOne 变更并发送到目标端。'],['双端核对','源端和目标端都按同一新订单号返回一行。']],
    observe:'页面显示本次新订单号，两端核对 SQL 返回的行数都应为 1。目标端查询真正连接独立 MySQL 容器。',
    caution:'目标端由本机容器提供；首次拉取镜像及同步检查点可能需要一些时间。',
  },
};
