-- =====================================================================
-- MatrixOne / OmniFabric Capabilities Workbook (single file, self-contained)
-- Seven capabilities: Transactions / Analytics / Git-for-Data /
--   Vector+FullText / Hybrid search / Stage(unstructured) / Task scheduling
-- Verified end-to-end on OmniFabric v4.0.0-rc2 (MatrixOne 4.0); also runs on v3.0.11.
-- 4.0 adaptations:
--   * subtract decimal literals (e.g. - 3999.00) to avoid the 4.0
--     "decimal minus integer with negative result -> Decimal128 overflow" bug
--   * Git4Data rollback via snapshot-read rebuild (RESTORE fails to parse on 4.0);
--     data branch uses INT cents; no dependency on mo_branch_metadata (removed in 4.0)
--   * no TPC-H sample-data dependency; hybrid search uses materialized recall
-- Run:  mysql -h <host> -P 6001 -u '<account>:admin:accountadmin' -p'<pwd>' --force < mo_workbook_en.sql
-- !! Section 6 (Stage) needs object-storage credentials; replace the placeholders, do NOT commit real keys.
-- =====================================================================
DROP DATABASE IF EXISTS mo_workbook;
CREATE DATABASE mo_workbook;
USE mo_workbook;
SET experimental_fulltext_index = 1;
SET experimental_hnsw_index = 1;
SET experimental_ivf_index = 1;


-- =====================================================================
-- 0. Schema + seed data
-- =====================================================================
SELECT '##### 0. Initialize data #####' AS workbook;

CREATE TABLE accounts (
  acct_id INT PRIMARY KEY, user_name VARCHAR(32) NOT NULL,
  balance DECIMAL(12,2) NOT NULL CHECK (balance >= 0), updated_at DATETIME
);
INSERT INTO accounts VALUES
 (1,'Alice',8000.00,NULL),(2,'Bob',5000.00,NULL),(3,'Carol',12000.00,NULL),
 (4,'David',300.00,NULL),(5,'Emma',6000.00,NULL);

CREATE TABLE products (
  product_id BIGINT PRIMARY KEY,           -- BIGINT so HNSW index is allowed
  name VARCHAR(64) NOT NULL, category VARCHAR(16) NOT NULL, brand VARCHAR(16),
  price DECIMAL(10,2) NOT NULL, description TEXT, embedding VECF32(4)
);
INSERT INTO products VALUES
 (101,'Smart Watch Pro','Electronics','Geek',1299.00,'Smart watch with HD touchscreen, 50m waterproof, heart rate and blood oxygen monitoring, 14-day battery life, rich sport modes','[0.92,0.80,0.30,0.75]'),
 (102,'Wireless Sport Earbuds','Electronics','Geek',399.00,'In-ear bluetooth sport earbuds, IPX7 waterproof and sweatproof, low latency, 30-hour battery, for running and fitness','[0.82,0.90,0.20,0.40]'),
 (103,'4K Aerial Drone','Electronics','SkyEye',3999.00,'4K HD aerial drone, 3-axis gimbal stabilization, 35-minute battery, outdoor travel aerial photography','[0.95,0.30,0.88,0.92]'),
 (104,'Hiking Backpack 50L','Outdoor','Wild',599.00,'50L large-capacity hiking backpack, water-repellent fabric, multi-compartment, breathable carrying system','[0.10,0.55,0.95,0.55]'),
 (105,'Racing Running Shoes','Sports','Gale',699.00,'Lightweight cushioned racing running shoes, high-rebound midsole, breathable mesh, for marathon sport training','[0.12,0.95,0.40,0.55]'),
 (106,'RGB Mechanical Keyboard','Electronics','Geek',459.00,'104-key RGB backlit mechanical keyboard, hot-swappable switches, full anti-ghosting, for gaming and office','[0.90,0.12,0.05,0.50]'),
 (107,'Auto Camping Tent','Outdoor','Wild',899.00,'Two-person automatic pop-up camping tent, 3000mm waterproof and windproof, outdoor camping gear','[0.06,0.30,0.92,0.62]'),
 (108,'Smart Body Scale','Electronics','Geek',159.00,'Smart body-fat scale with bluetooth app, monitors weight and body fat, essential for fitness','[0.70,0.72,0.12,0.30]'),
 (109,'Waterproof Jacket','Outdoor','Wild',799.00,'Three-in-one outdoor waterproof jacket, windproof warm breathable, detachable liner, for hiking and skiing','[0.12,0.62,0.86,0.62]'),
 (110,'Noise-Cancel Headphones','Electronics','Acoustic',1099.00,'Active noise-cancelling over-ear headphones, Hi-Res audio, 40-hour battery, comfortable for commute and travel','[0.86,0.22,0.10,0.72]');

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

-- Vector index (HNSW) + full-text index (default word parser for English)
CREATE INDEX idx_vec USING HNSW ON products(embedding) OP_TYPE 'vector_l2_ops';
CREATE FULLTEXT INDEX idx_ft ON products(description);
SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM sales) AS sales_rows;


-- =====================================================================
-- 1. Transactions (ACID)
-- =====================================================================
SELECT '##### 1. Transactions (ACID) #####' AS workbook;

SELECT '-- 1a Atomic commit: deduct balance + stock + write order + line, all-or-nothing --' AS step;
BEGIN;
  UPDATE accounts  SET balance = balance - 1299.00, updated_at = now() WHERE acct_id = 1;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 101;
  INSERT INTO orders      VALUES (1001,1,now(),'PAID',1299.00);
  INSERT INTO order_items VALUES (1001,101,1,1299.00);
COMMIT;
SELECT a.user_name, a.balance, i.stock FROM accounts a, inventory i WHERE a.acct_id=1 AND i.product_id=101;

SELECT '-- 1b Rollback: visible inside the txn, fully undone after ROLLBACK --' AS step;
BEGIN;
  UPDATE accounts SET balance = balance - 5000.00 WHERE acct_id = 3;
  SELECT balance AS balance_in_txn FROM accounts WHERE acct_id = 3;
ROLLBACK;
SELECT balance AS balance_after_rollback FROM accounts WHERE acct_id = 3;

SELECT '-- 1c Constraint guard: insufficient balance trips CHECK, whole txn rolls back, zero dirty data --' AS step;
BEGIN;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 103;
  INSERT INTO orders VALUES (1002,4,now(),'PENDING',3999.00);
  UPDATE accounts SET balance = balance - 3999.00 WHERE acct_id = 4;   -- 300-3999<0 trips CHECK(balance>=0)
ROLLBACK;
SELECT (SELECT balance FROM accounts WHERE acct_id=4) AS david_balance_still_300,
       (SELECT stock FROM inventory WHERE product_id=103) AS drone_stock_still_45,
       (SELECT COUNT(*) FROM orders WHERE order_id=1002) AS order_1002_should_be_0;


-- =====================================================================
-- 2. Analytics (OLAP)
-- =====================================================================
SELECT '##### 2. Analytics (OLAP) #####' AS workbook;

SELECT '-- 2a Category sales overview + share window --' AS step;
SELECT p.category, COUNT(*) AS orders_cnt, SUM(s.qty) AS qty, SUM(s.amount) AS revenue,
       ROUND(SUM(s.amount)*100.0/SUM(SUM(s.amount)) OVER (),2) AS pct
FROM sales s JOIN products p ON s.product_id=p.product_id GROUP BY p.category ORDER BY revenue DESC;

SELECT '-- 2b Top products by revenue (RANK window) --' AS step;
SELECT RANK() OVER (ORDER BY SUM(s.amount) DESC) AS rnk, p.name, SUM(s.amount) AS revenue
FROM sales s JOIN products p ON s.product_id=p.product_id GROUP BY p.product_id,p.name ORDER BY rnk LIMIT 5;

SELECT '-- 2c Monthly trend + MoM growth (LAG) + running total --' AS step;
WITH m AS (SELECT DATE_FORMAT(sale_date,'%Y-%m') ym, SUM(amount) rev FROM sales GROUP BY DATE_FORMAT(sale_date,'%Y-%m'))
SELECT ym AS month, rev AS revenue, LAG(rev) OVER (ORDER BY ym) AS prev_month,
       ROUND((rev-LAG(rev) OVER (ORDER BY ym))*100.0/LAG(rev) OVER (ORDER BY ym),2) AS mom_pct,
       SUM(rev) OVER (ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
FROM m ORDER BY ym;

SELECT '-- 2d Multi-dimensional rollup (WITH ROLLUP) --' AS step;
SELECT COALESCE(p.category,'[ALL]') AS category, COALESCE(DATE_FORMAT(s.sale_date,'%Y-%m'),'[TOTAL]') AS month, SUM(s.amount) AS revenue
FROM sales s JOIN products p ON s.product_id=p.product_id
GROUP BY p.category, DATE_FORMAT(s.sale_date,'%Y-%m') WITH ROLLUP ORDER BY category, month LIMIT 10;


-- =====================================================================
-- 3. Git for Data
-- =====================================================================
SELECT '##### 3. Git for Data #####' AS workbook;

SELECT '-- 3a Snapshot + bad update + time-travel read --' AS step;
DROP SNAPSHOT IF EXISTS wb_snap;
CREATE SNAPSHOT wb_snap FOR TABLE mo_workbook products;
UPDATE products SET price = price * 10 WHERE product_id = 101;   -- watch price blown up 10x (multiply, avoids the subtract bug)
SELECT name, price AS price_now_wrong FROM products WHERE product_id=101;
SELECT name, price AS price_history FROM products {snapshot='wb_snap'} WHERE product_id=101;

SELECT '-- 3b Rollback via snapshot-read rebuild (works on any version; RESTORE fails to parse on 4.0) --' AS step;
DELETE FROM products WHERE product_id=101;
INSERT INTO products SELECT * FROM products {snapshot='wb_snap'} WHERE product_id=101;
SELECT name, price AS price_restored FROM products WHERE product_id=101;

SELECT '-- 3c Data branch: branch the price list (INT cents) -> DIFF -> MERGE --' AS step;
DROP TABLE IF EXISTS pb_promo; DROP TABLE IF EXISTS price_book;
CREATE TABLE price_book(product_id BIGINT PRIMARY KEY, name VARCHAR(64), price_cents INT);
INSERT INTO price_book SELECT product_id, name, CAST(price*100 AS SIGNED) FROM products;
DATA BRANCH CREATE TABLE pb_promo FROM price_book;        -- note: in Cloud web console a single statement fails due to injected comment; run via CLI
UPDATE pb_promo SET price_cents = price_cents*8/10 WHERE product_id IN (101,103);
INSERT INTO pb_promo VALUES (999,'Promo Bundle',9900);
DELETE FROM pb_promo WHERE product_id=108;
SELECT '   DIFF full rows:' AS x;
DATA BRANCH DIFF pb_promo AGAINST price_book;
SELECT '   DIFF summary:' AS x;
DATA BRANCH DIFF pb_promo AGAINST price_book OUTPUT SUMMARY;
DATA BRANCH MERGE pb_promo INTO price_book WHEN CONFLICT ACCEPT;
SELECT COUNT(*) AS rows_after_merge FROM price_book;

SELECT '-- 3d PITR: point-in-time recovery window --' AS step;
DROP PITR IF EXISTS wb_pitr;
CREATE PITR wb_pitr FOR DATABASE mo_workbook RANGE 7 'd';
SHOW PITR WHERE PITR_NAME='wb_pitr';


-- =====================================================================
-- 4. Vector search + Full-text search
-- =====================================================================
SELECT '##### 4. Vector + Full-text #####' AS workbook;

SELECT '-- 4a Vector similarity: nearest to a "smart sport gadget" (L2) --' AS step;
SELECT name, category, ROUND(l2_distance(embedding,'[0.85,0.88,0.20,0.50]'),4) AS l2_distance
FROM products ORDER BY l2_distance(embedding,'[0.85,0.88,0.20,0.50]') LIMIT 5;

SELECT '-- 4b Full-text: descriptions containing "waterproof" + relevance score (must not wrap MATCH in a function) --' AS step;
SELECT name, MATCH(description) AGAINST('waterproof') AS relevance
FROM products WHERE MATCH(description) AGAINST('waterproof') ORDER BY relevance DESC;

SELECT '-- 4c Full-text boolean: contains both "waterproof" and "battery" --' AS step;
SELECT name FROM products WHERE MATCH(description) AGAINST('+waterproof +battery' IN BOOLEAN MODE);


-- =====================================================================
-- 5. Hybrid search (vector + full-text + scalar; RRF fusion)
-- =====================================================================
SELECT '##### 5. Hybrid search #####' AS workbook;

SELECT '-- 5a Three signals in one SQL: full-text "waterproof" + price<1000 + order by outdoor vector --' AS step;
SELECT name, price, ROUND(l2_distance(embedding,'[0.10,0.55,0.92,0.58]'),4) AS outdoor_distance
FROM products WHERE MATCH(description) AGAINST('waterproof') AND price < 1000
ORDER BY l2_distance(embedding,'[0.10,0.55,0.92,0.58]') LIMIT 5;

SELECT '-- 5b RRF fusion: keyword recall + vector recall, materialized then fused --' AS step;
DROP TABLE IF EXISTS _kw; DROP TABLE IF EXISTS _sem;
CREATE TABLE _kw(product_id BIGINT);
CREATE TABLE _sem(product_id BIGINT, sem_rank INT, dist DOUBLE);
INSERT INTO _kw SELECT product_id FROM products WHERE MATCH(description) AGAINST('waterproof sport fitness' IN BOOLEAN MODE);
INSERT INTO _sem(product_id,dist,sem_rank)
  SELECT product_id,dist,ROW_NUMBER() OVER (ORDER BY dist)
  FROM (SELECT product_id, l2_distance(embedding,'[0.85,0.88,0.20,0.50]') dist FROM products ORDER BY dist LIMIT 6) t;
WITH cand AS (SELECT product_id FROM _kw UNION SELECT product_id FROM _sem),
kw AS (SELECT k.product_id, ROW_NUMBER() OVER (ORDER BY COUNT(s.sale_id) DESC, k.product_id) kw_rank
       FROM _kw k LEFT JOIN sales s ON k.product_id=s.product_id GROUP BY k.product_id)
SELECT p.name, kw.kw_rank AS keyword_rank, sem.sem_rank AS vector_rank,
       ROUND(COALESCE(1.0/(60+kw.kw_rank),0)+COALESCE(1.0/(60+sem.sem_rank),0),6) AS rrf_score
FROM cand c JOIN products p ON c.product_id=p.product_id
LEFT JOIN kw ON c.product_id=kw.product_id LEFT JOIN _sem sem ON c.product_id=sem.product_id
ORDER BY rrf_score DESC LIMIT 8;
DROP TABLE IF EXISTS _kw; DROP TABLE IF EXISTS _sem;


-- =====================================================================
-- 6. Stage + unstructured data (object storage)
-- !! Replace CREDENTIALS / bucket with your own object storage.
-- =====================================================================
SELECT '##### 6. Stage (unstructured) #####' AS workbook;
DROP STAGE IF EXISTS wb_stage;
CREATE STAGE wb_stage
  URL='s3://<your-bucket>/mo-workbook/'
  CREDENTIALS={'AWS_KEY_ID'='<YOUR_ACCESS_KEY_ID>','AWS_SECRET_KEY'='<YOUR_SECRET_ACCESS_KEY>',
               'AWS_REGION'='ap-shanghai','ENDPOINT'='cos.ap-shanghai.myqcloud.com','PROVIDER'='cos','COMPRESSION'='none'}
  ENABLE=TRUE;
SHOW STAGES LIKE 'wb_stage';

SELECT '-- 6a save_file: write a product manual to object storage (already-exists on rerun is OK) --' AS step;
SELECT save_file(cast('stage://wb_stage/manual_101.txt' as datalink),'[Smart Watch Pro Manual] 50m waterproof; heart rate / blood oxygen monitoring; 14-day battery life.') AS manual_bytes;

SELECT '-- 6b datalink register asset + load_file joined with structured data --' AS step;
TRUNCATE TABLE assets;
INSERT INTO assets VALUES (1,101,'manual','manual_101.txt',cast('stage://wb_stage/manual_101.txt' as datalink));
SELECT p.name, a.file_name, load_file(a.file_link) AS manual_content_from_object_storage
FROM products p JOIN assets a ON p.product_id=a.product_id;


-- =====================================================================
-- 7. Task scheduling (native SQL Task)
-- =====================================================================
SELECT '##### 7. Task scheduling (SQL Task) #####' AS workbook;
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

SELECT '-- 7a Trigger once manually + view task definition and run history --' AS step;
EXECUTE TASK wb_rollup_task;
SHOW TASKS;
SHOW TASK RUNS FOR wb_rollup_task LIMIT 5;
SELECT summary_date, order_cnt, total_amount FROM sales_daily_summary ORDER BY summary_date DESC LIMIT 5;


-- =====================================================================
SELECT '##### Workbook finished #####' AS workbook;
-- Cleanup (optional): DROP TASK wb_rollup_task; DROP SNAPSHOT wb_snap; DROP PITR wb_pitr; DROP STAGE wb_stage; DROP DATABASE mo_workbook;
