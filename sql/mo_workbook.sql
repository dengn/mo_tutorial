-- =====================================================================
-- MatrixOne / OmniFabric 能力总览 Workbook（单文件 · 自包含 · 从头跑到尾）
-- 七大能力：事务 / 分析 / Git4Data / 向量+全文 / 混合查询 / Stage / 任务调度
-- 已针对 OmniFabric v4.0.0-rc2 适配（兼容 MatrixOne v3.0.11）：
--   · 余额相减用「小数字面量」(如 - 3999.00) 绕开 4.0「小数减整数得负数→溢出」bug
--   · Git4Data 回滚用「快照读重建」(RESTORE 在 4.0 解析失败)，分支用 INT 价、不依赖 mo_branch_metadata
--   · 分析不依赖 TPC-H 样例库；全文/向量混合用「物化召回」绕开 MATCH 组合限制
-- 运行：mysql -h <host> -P 6001 -u '<account>:admin:accountadmin' -p'<pwd>' --force < mo_workbook.sql
-- ⚠️ 第 6 节 Stage 含对象存储 AK/SK：请换成你自己的，勿提交公开仓库。
-- =====================================================================
DROP DATABASE IF EXISTS mo_workbook;
CREATE DATABASE mo_workbook;
USE mo_workbook;
SET experimental_fulltext_index = 1;
SET experimental_hnsw_index = 1;
SET experimental_ivf_index = 1;


-- =====================================================================
-- 0. 建表 + 造数
-- =====================================================================
SELECT '##### 0. 初始化数据 #####' AS workbook;

CREATE TABLE accounts (
  acct_id INT PRIMARY KEY, user_name VARCHAR(32) NOT NULL,
  balance DECIMAL(12,2) NOT NULL CHECK (balance >= 0), updated_at DATETIME
);
INSERT INTO accounts VALUES
 (1,'张伟',8000.00,NULL),(2,'李娜',5000.00,NULL),(3,'王芳',12000.00,NULL),
 (4,'刘强',300.00,NULL),(5,'陈静',6000.00,NULL);

CREATE TABLE products (
  product_id BIGINT PRIMARY KEY,           -- BIGINT 以支持 HNSW
  name VARCHAR(64) NOT NULL, category VARCHAR(16) NOT NULL, brand VARCHAR(16),
  price DECIMAL(10,2) NOT NULL, description TEXT, embedding VECF32(4)
);
INSERT INTO products VALUES
 (101,'智能手表 Pro 旗舰版','电子','极客',1299.00,'高清触屏智能手表，支持50米防水、心率血氧监测、超长续航14天，运动模式丰富','[0.92,0.80,0.30,0.75]'),
 (102,'无线蓝牙运动耳机','电子','极客',399.00,'入耳式蓝牙运动耳机，IPX7级防水防汗，低延迟，续航30小时，跑步健身专用','[0.82,0.90,0.20,0.40]'),
 (103,'4K高清航拍无人机','电子','天眼',3999.00,'4K高清航拍无人机，三轴云台增稳，35分钟超长续航，户外旅行航拍利器','[0.95,0.30,0.88,0.92]'),
 (104,'专业登山背包50L','户外','山野',599.00,'50升大容量专业登山背包，防泼水面料，多隔层设计，承重透气背负系统','[0.10,0.55,0.95,0.55]'),
 (105,'轻量竞速跑步鞋','运动','疾风',699.00,'轻量缓震竞速跑步鞋，高回弹中底，透气网面，马拉松训练与比赛适用','[0.12,0.95,0.40,0.55]'),
 (106,'机械键盘RGB背光','电子','极客',459.00,'104键RGB背光机械键盘，热插拔轴体，全键无冲，游戏办公两用','[0.90,0.12,0.05,0.50]'),
 (107,'双人自动露营帐篷','户外','山野',899.00,'双人自动速开露营帐篷，3000mm防水防风，户外野营装备','[0.06,0.30,0.92,0.62]'),
 (108,'智能体脂秤','电子','极客',159.00,'智能体脂秤蓝牙连接APP，监测体重体脂率等多项身体数据，健身减脂必备','[0.70,0.72,0.12,0.30]'),
 (109,'户外防水冲锋衣','户外','山野',799.00,'三合一户外防水冲锋衣，防风保暖透气，可拆卸内胆，登山徒步滑雪适用','[0.12,0.62,0.86,0.62]'),
 (110,'主动降噪头戴耳机','电子','声学',1099.00,'主动降噪头戴式耳机，Hi-Res音质，40小时续航，佩戴舒适，通勤旅行','[0.86,0.22,0.10,0.72]');

CREATE TABLE inventory (product_id BIGINT PRIMARY KEY, stock INT NOT NULL CHECK (stock >= 0));
INSERT INTO inventory VALUES (101,120),(102,300),(103,45),(104,80),(105,200),(106,150),(107,60),(108,400),(109,110),(110,90);

CREATE TABLE orders (order_id INT PRIMARY KEY, acct_id INT NOT NULL, order_time DATETIME NOT NULL, status VARCHAR(16) NOT NULL, total_amount DECIMAL(12,2) NOT NULL);
CREATE TABLE order_items (order_id INT NOT NULL, product_id BIGINT NOT NULL, qty INT NOT NULL, price DECIMAL(10,2) NOT NULL, PRIMARY KEY (order_id, product_id));

CREATE TABLE sales (sale_id INT PRIMARY KEY, sale_date DATE NOT NULL, acct_id INT NOT NULL, product_id BIGINT NOT NULL, qty INT NOT NULL, unit_price DECIMAL(10,2), amount DECIMAL(12,2));
INSERT INTO sales (sale_id, sale_date, acct_id, product_id, qty)
SELECT sale_id, DATE_ADD('2025-12-01', INTERVAL day_off DAY), acct_id, product_id, qty
FROM (
  SELECT g.result AS sale_id, (g.result*11)%180 AS day_off,
         1+((g.result*3)%5) AS acct_id, 101+((g.result*7)%10) AS product_id, 1+((g.result*13)%3) AS qty
  FROM generate_series(1,3000) g
) t;
UPDATE sales s JOIN products p ON s.product_id=p.product_id SET s.unit_price=p.price, s.amount=p.price*s.qty;

CREATE TABLE assets (asset_id INT PRIMARY KEY, product_id BIGINT, asset_type VARCHAR(16), file_name VARCHAR(128), file_link DATALINK);

-- 向量索引(HNSW) + 全文索引(ngram)
CREATE INDEX idx_vec USING HNSW ON products(embedding) OP_TYPE 'vector_l2_ops';
CREATE FULLTEXT INDEX idx_ft ON products(description) WITH PARSER ngram;
SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM sales) AS sales_rows;


-- =====================================================================
-- 1. 事务能力 (ACID)
-- =====================================================================
SELECT '##### 1. 事务 ACID #####' AS workbook;

SELECT '-- 1a 原子提交：扣余额+扣库存+写订单+写明细，四表同生共死 --' AS step;
BEGIN;
  UPDATE accounts  SET balance = balance - 1299.00, updated_at = now() WHERE acct_id = 1;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 101;
  INSERT INTO orders      VALUES (1001,1,now(),'PAID',1299.00);
  INSERT INTO order_items VALUES (1001,101,1,1299.00);
COMMIT;
SELECT a.user_name, a.balance, i.stock FROM accounts a, inventory i WHERE a.acct_id=1 AND i.product_id=101;

SELECT '-- 1b 主动回滚：事务内可见，ROLLBACK 后全部撤销 --' AS step;
BEGIN;
  UPDATE accounts SET balance = balance - 5000.00 WHERE acct_id = 3;
  SELECT balance AS `事务内余额` FROM accounts WHERE acct_id = 3;
ROLLBACK;
SELECT balance AS `回滚后余额` FROM accounts WHERE acct_id = 3;

SELECT '-- 1c 约束保护：余额不足触发 CHECK，整笔回滚、零脏数据 --' AS step;
BEGIN;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 103;
  INSERT INTO orders VALUES (1002,4,now(),'PENDING',3999.00);
  UPDATE accounts SET balance = balance - 3999.00 WHERE acct_id = 4;   -- 300-3999<0 触发 CHECK
ROLLBACK;
SELECT (SELECT balance FROM accounts WHERE acct_id=4) AS `刘强余额(仍300)`,
       (SELECT stock FROM inventory WHERE product_id=103) AS `无人机库存(仍45)`,
       (SELECT COUNT(*) FROM orders WHERE order_id=1002) AS `订单1002(应0)`;


-- =====================================================================
-- 2. 分析能力 (OLAP)
-- =====================================================================
SELECT '##### 2. OLAP 分析 #####' AS workbook;

SELECT '-- 2a 品类销售概览 + 占比窗口 --' AS step;
SELECT p.category AS `品类`, COUNT(*) AS `订单数`, SUM(s.qty) AS `销量`, SUM(s.amount) AS `销售额`,
       ROUND(SUM(s.amount)*100.0/SUM(SUM(s.amount)) OVER (),2) AS `占比%`
FROM sales s JOIN products p ON s.product_id=p.product_id GROUP BY p.category ORDER BY `销售额` DESC;

SELECT '-- 2b 单品销售额排行 RANK 窗口 --' AS step;
SELECT RANK() OVER (ORDER BY SUM(s.amount) DESC) AS `排名`, p.name AS `商品`, SUM(s.amount) AS `销售额`
FROM sales s JOIN products p ON s.product_id=p.product_id GROUP BY p.product_id,p.name ORDER BY `排名` LIMIT 5;

SELECT '-- 2c 月度趋势 + 环比 LAG + 累计窗口 --' AS step;
WITH m AS (SELECT DATE_FORMAT(sale_date,'%Y-%m') ym, SUM(amount) rev FROM sales GROUP BY DATE_FORMAT(sale_date,'%Y-%m'))
SELECT ym AS `月份`, rev AS `销售额`, LAG(rev) OVER (ORDER BY ym) AS `上月`,
       ROUND((rev-LAG(rev) OVER (ORDER BY ym))*100.0/LAG(rev) OVER (ORDER BY ym),2) AS `环比%`,
       SUM(rev) OVER (ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS `累计`
FROM m ORDER BY ym;

SELECT '-- 2d 多维汇总 WITH ROLLUP --' AS step;
SELECT COALESCE(p.category,'【全部】') AS `品类`, COALESCE(DATE_FORMAT(s.sale_date,'%Y-%m'),'【合计】') AS `月份`, SUM(s.amount) AS `销售额`
FROM sales s JOIN products p ON s.product_id=p.product_id
GROUP BY p.category, DATE_FORMAT(s.sale_date,'%Y-%m') WITH ROLLUP ORDER BY `品类`,`月份` LIMIT 10;


-- =====================================================================
-- 3. Git for Data
-- =====================================================================
SELECT '##### 3. Git for Data #####' AS workbook;

SELECT '-- 3a 快照打版本 + 误改 + 时间旅行读历史 --' AS step;
DROP SNAPSHOT IF EXISTS wb_snap;
CREATE SNAPSHOT wb_snap FOR TABLE mo_workbook products;
UPDATE products SET price = price * 10 WHERE product_id = 101;   -- 误把手表价放大10倍(乘法,不踩减法bug)
SELECT name, price AS `现价(已改错)` FROM products WHERE product_id=101;
SELECT name, price AS `历史价(时间旅行)` FROM products {snapshot='wb_snap'} WHERE product_id=101;

SELECT '-- 3b 回滚：快照读重建(任何版本都行；4.0 上 RESTORE 解析失败) --' AS step;
DELETE FROM products WHERE product_id=101;
INSERT INTO products SELECT * FROM products {snapshot='wb_snap'} WHERE product_id=101;
SELECT name, price AS `回滚后价` FROM products WHERE product_id=101;

SELECT '-- 3c 数据分支：拉促销分支(INT分存价) → DIFF → MERGE --' AS step;
DROP TABLE IF EXISTS pb_promo; DROP TABLE IF EXISTS price_book;
CREATE TABLE price_book(product_id BIGINT PRIMARY KEY, name VARCHAR(64), price_cents INT);
INSERT INTO price_book SELECT product_id, name, CAST(price*100 AS SIGNED) FROM products;
DATA BRANCH CREATE TABLE pb_promo FROM price_book;        -- 注:Cloud控制台单条执行会因注入注释失败,用命令行
UPDATE pb_promo SET price_cents = price_cents*8/10 WHERE product_id IN (101,103);
INSERT INTO pb_promo VALUES (999,'促销福袋',9900);
DELETE FROM pb_promo WHERE product_id=108;
SELECT '   DIFF 全列:' AS x;
DATA BRANCH DIFF pb_promo AGAINST price_book;
SELECT '   DIFF 概览:' AS x;
DATA BRANCH DIFF pb_promo AGAINST price_book OUTPUT SUMMARY;
DATA BRANCH MERGE pb_promo INTO price_book WHEN CONFLICT ACCEPT;
SELECT COUNT(*) AS `合并后主表行数` FROM price_book;

SELECT '-- 3d PITR 连续时间点恢复 --' AS step;
DROP PITR IF EXISTS wb_pitr;
CREATE PITR wb_pitr FOR DATABASE mo_workbook RANGE 7 'd';
SHOW PITR WHERE PITR_NAME='wb_pitr';


-- =====================================================================
-- 4. 向量检索 + 全文检索
-- =====================================================================
SELECT '##### 4. 向量 + 全文 #####' AS workbook;

SELECT '-- 4a 向量相似度：找最像「智能运动装备」的商品(L2) --' AS step;
SELECT name AS `商品`, category AS `品类`, ROUND(l2_distance(embedding,'[0.85,0.88,0.20,0.50]'),4) AS `L2距离`
FROM products ORDER BY l2_distance(embedding,'[0.85,0.88,0.20,0.50]') LIMIT 5;

SELECT '-- 4b 全文检索：描述含「防水」+ 相关度(评分不可被函数包裹) --' AS step;
SELECT name AS `商品`, MATCH(description) AGAINST('防水') AS `相关度`
FROM products WHERE MATCH(description) AGAINST('防水') ORDER BY `相关度` DESC;

SELECT '-- 4c 全文布尔模式：同时含「防水」和「续航」--' AS step;
SELECT name AS `商品` FROM products WHERE MATCH(description) AGAINST('+防水 +续航' IN BOOLEAN MODE);


-- =====================================================================
-- 5. 混合查询（向量 + 全文 + 标量；RRF 融合）
-- =====================================================================
SELECT '##### 5. 混合查询 #####' AS workbook;

SELECT '-- 5a 三路一条SQL：全文命中「防水」+ 价格<1000 + 按户外语义向量排序 --' AS step;
SELECT name AS `商品`, price AS `价格`, ROUND(l2_distance(embedding,'[0.10,0.55,0.92,0.58]'),4) AS `户外语义距离`
FROM products WHERE MATCH(description) AGAINST('防水') AND price < 1000
ORDER BY l2_distance(embedding,'[0.10,0.55,0.92,0.58]') LIMIT 5;

SELECT '-- 5b RRF 融合：关键词召回 ⊕ 向量召回，物化后纯关系融合 --' AS step;
DROP TABLE IF EXISTS _kw; DROP TABLE IF EXISTS _sem;
CREATE TABLE _kw(product_id BIGINT);
CREATE TABLE _sem(product_id BIGINT, sem_rank INT, dist DOUBLE);
INSERT INTO _kw SELECT product_id FROM products WHERE MATCH(description) AGAINST('防水 运动 健身' IN BOOLEAN MODE);
INSERT INTO _sem(product_id,dist,sem_rank)
  SELECT product_id,dist,ROW_NUMBER() OVER (ORDER BY dist)
  FROM (SELECT product_id, l2_distance(embedding,'[0.85,0.88,0.20,0.50]') dist FROM products ORDER BY dist LIMIT 6) t;
WITH cand AS (SELECT product_id FROM _kw UNION SELECT product_id FROM _sem),
kw AS (SELECT k.product_id, ROW_NUMBER() OVER (ORDER BY COUNT(s.sale_id) DESC, k.product_id) kw_rank
       FROM _kw k LEFT JOIN sales s ON k.product_id=s.product_id GROUP BY k.product_id)
SELECT p.name AS `商品`, kw.kw_rank AS `关键词名次`, sem.sem_rank AS `语义名次`,
       ROUND(COALESCE(1.0/(60+kw.kw_rank),0)+COALESCE(1.0/(60+sem.sem_rank),0),6) AS `RRF融合分`
FROM cand c JOIN products p ON c.product_id=p.product_id
LEFT JOIN kw ON c.product_id=kw.product_id LEFT JOIN _sem sem ON c.product_id=sem.product_id
ORDER BY `RRF融合分` DESC LIMIT 8;
DROP TABLE IF EXISTS _kw; DROP TABLE IF EXISTS _sem;


-- =====================================================================
-- 6. Stage + 非结构化数据（对象存储）
-- ⚠️ 把 CREDENTIALS / bucket 换成你自己的对象存储凭据
-- =====================================================================
SELECT '##### 6. Stage 非结构化 #####' AS workbook;
DROP STAGE IF EXISTS wb_stage;
CREATE STAGE wb_stage
  URL='s3://<your-bucket>/mo-workbook/'
  CREDENTIALS={'AWS_KEY_ID'='<YOUR_ACCESS_KEY_ID>','AWS_SECRET_KEY'='<YOUR_SECRET_ACCESS_KEY>',
               'AWS_REGION'='ap-shanghai','ENDPOINT'='cos.ap-shanghai.myqcloud.com','PROVIDER'='cos','COMPRESSION'='none'}
  ENABLE=TRUE;
SHOW STAGES LIKE 'wb_stage';

SELECT '-- 6a save_file 写商品手册到对象存储(重复运行报already exists可忽略) --' AS step;
SELECT save_file(cast('stage://wb_stage/manual_101.txt' as datalink),'【智能手表 Pro 用户手册】50米防水；心率/血氧监测；续航14天。') AS `手册字节`;

SELECT '-- 6b datalink 登记资产 + load_file 与结构化数据 JOIN --' AS step;
TRUNCATE TABLE assets;
INSERT INTO assets VALUES (1,101,'manual','manual_101.txt',cast('stage://wb_stage/manual_101.txt' as datalink));
SELECT p.name AS `商品`, a.file_name AS `手册`, load_file(a.file_link) AS `手册内容(从对象存储读)`
FROM products p JOIN assets a ON p.product_id=a.product_id;


-- =====================================================================
-- 7. 任务调度（原生 SQL Task）
-- =====================================================================
SELECT '##### 7. 任务调度 SQL Task #####' AS workbook;
CREATE TABLE IF NOT EXISTS sales_daily_summary (summary_date DATE PRIMARY KEY, order_cnt INT, total_qty INT, total_amount DECIMAL(14,2), refreshed_at DATETIME);
DROP TASK IF EXISTS wb_rollup_task;

DELIMITER $$
CREATE TASK wb_rollup_task
  SCHEDULE '0 0 2 * * *' TIMEZONE 'Asia/Shanghai' RETRY 1 TIMEOUT '5m'
AS BEGIN
  INSERT INTO mo_workbook.sales_daily_summary (summary_date, order_cnt, total_qty, total_amount, refreshed_at)
  SELECT sale_date, COUNT(*), SUM(qty), SUM(amount), now() FROM mo_workbook.sales GROUP BY sale_date
  ON DUPLICATE KEY UPDATE order_cnt=VALUES(order_cnt), total_qty=VALUES(total_qty), total_amount=VALUES(total_amount), refreshed_at=VALUES(refreshed_at);
END $$
DELIMITER ;

SELECT '-- 7a 手动触发一次 + 查看任务定义与执行历史 --' AS step;
EXECUTE TASK wb_rollup_task;
SHOW TASKS;
SHOW TASK RUNS FOR wb_rollup_task LIMIT 5;
SELECT summary_date AS `日期`, order_cnt AS `订单数`, total_amount AS `销售额` FROM sales_daily_summary ORDER BY summary_date DESC LIMIT 5;


-- =====================================================================
SELECT '##### Workbook 全部跑完 #####' AS workbook;
-- 清理(按需)：DROP TASK wb_rollup_task; DROP SNAPSHOT wb_snap; DROP PITR wb_pitr; DROP STAGE wb_stage; DROP DATABASE mo_workbook;
