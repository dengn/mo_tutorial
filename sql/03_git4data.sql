-- =====================================================================
-- 能力三：Git for Data（数据版本管理）—— 两套互补机制
--   A. 快照 Snapshot + 时间旅行 + 一键回滚 RESTORE + PITR（= git tag / 历史回溯）
--   B. 数据分支 Data Branch：CREATE 拉分支 / DIFF 看差异 / MERGE 合并（= git branch/merge）
-- 场景：MO 商城「价格治理」——历史快照保命，促销改价走分支评审。
-- 注意：RESTORE 需指定账户名（下方用本实例账户，换实例请替换）。
-- 建议执行： mysql ... --force < 03_git4data.sql
-- =====================================================================
USE mo_demo;

-- 清理上次遗留
DROP SNAPSHOT IF EXISTS prod_v1;
DROP TABLE IF EXISTS products_audit_branch;
DROP TABLE IF EXISTS price_book_promo;
DROP TABLE IF EXISTS price_book;


-- =====================================================================
-- A. 快照 / 时间旅行 / 一键回滚
-- =====================================================================
SELECT '===== A1. 打数据版本快照（≈ git commit/tag）=====' AS step;
CREATE SNAPSHOT prod_v1 FOR TABLE mo_demo products;
SHOW SNAPSHOTS WHERE SNAPSHOT_NAME = 'prod_v1';

SELECT '===== A2. 误操作：运营把全场价格打成 1 折 =====' AS step;
UPDATE products SET price = ROUND(price * 0.1, 2);
SELECT product_id, name, price AS `现价(已改错)` FROM products WHERE product_id IN (101,103,110);

SELECT '===== A3. 时间旅行：直接读历史版本（{snapshot=...}）=====' AS step;
SELECT product_id, name, price AS `历史价格`
FROM products {snapshot = 'prod_v1'} WHERE product_id IN (101,103,110);

SELECT '===== A4. 一键回滚：RESTORE 把主表还原到 prod_v1 =====' AS step;
-- 账户名：自建实例默认是 sys；MatrixOne Cloud 上换成你的账户名（形如 0195...）。
RESTORE ACCOUNT `sys`
        DATABASE mo_demo TABLE products FROM SNAPSHOT prod_v1;
SELECT product_id, name, price AS `回滚后价格` FROM products WHERE product_id IN (101,103,110);


-- =====================================================================
-- B. 数据分支：拉分支 / 看差异 / 合并
--   说明：DATA BRANCH DIFF 的全列输出目前不支持 DECIMAL/向量列（报 unsupported mysql type 0），
--        故价格用 INT「分」存于 price_book 演示；如需对含 DECIMAL 的表做 DIFF，可用
--        OUTPUT SUMMARY 或 COLUMNS(...) 只投影非 DECIMAL 列。
-- =====================================================================
SELECT '===== B1. 建主价格表（生产分支），价格以「分」存（INT）=====' AS step;
CREATE TABLE price_book(
  product_id  BIGINT PRIMARY KEY,
  name        VARCHAR(64),
  price_cents INT,
  status      VARCHAR(16)
);
INSERT INTO price_book SELECT product_id, name, CAST(price*100 AS SIGNED), 'on_sale' FROM products;
SELECT COUNT(*) AS `主表商品数` FROM price_book;

SELECT '===== B2. 拉一个「促销提案」分支（DATA BRANCH CREATE，与主表完全独立）=====' AS step;
-- ⚠️ v3.0.11 已知问题：DATA BRANCH CREATE 若语句前有注释会报
--    "cannot find src and dst table"。MatrixOne Cloud Web 控制台会自动给每条语句
--    注入 /* cloud_user */ 前缀，因此这一句在控制台里会失败 —— 请改用 mysql 命令行执行
--    （DATA BRANCH DIFF / MERGE 不受影响）。
DATA BRANCH CREATE TABLE price_book_promo FROM price_book;

-- 在分支上做改动：手表/无人机打 8 折、上新「促销福袋」、下架「智能体脂秤」
UPDATE price_book_promo SET price_cents = CAST(price_cents*0.8 AS SIGNED) WHERE product_id IN (101,103);
INSERT INTO price_book_promo VALUES (999, '促销福袋', 9900, 'on_sale');
DELETE FROM price_book_promo WHERE product_id = 108;

-- 主表不受分支改动影响（隔离）
SELECT '主表 101 价格(未变)' AS `验证`, price_cents FROM price_book WHERE product_id=101;

SELECT '===== B3. 分支差异 DIFF：提案相对主表改了什么（全列）=====' AS step;
DATA BRANCH DIFF price_book_promo AGAINST price_book;

SELECT '===== B4. 差异概览 DIFF OUTPUT SUMMARY（增/删/改计数）=====' AS step;
DATA BRANCH DIFF price_book_promo AGAINST price_book OUTPUT SUMMARY;

SELECT '===== B5. 合并提案回主表（DATA BRANCH MERGE，冲突时取分支值）=====' AS step;
DATA BRANCH MERGE price_book_promo INTO price_book WHEN CONFLICT ACCEPT;
SELECT product_id, name, price_cents AS `合并后价格(分)`
FROM price_book ORDER BY product_id;

SELECT '===== B6. 分支展示：官方血缘元数据表（本版本可能为空）+ 现存分支表 =====' AS step;
-- 官方分支血缘表（table_id→p_table_id 父子关系）；部分版本/租户下为空
SELECT table_id, p_table_id, level FROM mo_catalog.mo_branch_metadata LIMIT 20;
-- 退而求其次：列出当前的分支相关表
SHOW TABLES LIKE 'price_book%';


-- =====================================================================
-- C. PITR：连续时间点恢复
-- =====================================================================
SELECT '===== C1. 开启 PITR（保留期内可恢复到任意时刻）=====' AS step;
DROP PITR IF EXISTS demo_pitr;
CREATE PITR demo_pitr FOR DATABASE mo_demo RANGE 7 'd';
SHOW PITR WHERE PITR_NAME = 'demo_pitr';

-- 收尾：保留 prod_v1 / demo_pitr / price_book 供查看；彻底清理见 99_cleanup.sql
SELECT '== Git for Data 演示完成：快照回滚 + 数据分支 Diff/Merge ==' AS done;
