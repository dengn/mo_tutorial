-- =====================================================================
-- Git for Data 完整 Workbook（自包含，可从头跑到尾）
-- 覆盖：快照 Snapshot / 时间旅行 Time-Travel / Diff / 克隆 Clone /
--       回滚 Restore / 连续恢复 PITR / 数据分支 Branch(Create·Diff·Merge)
-- 已在 OmniFabric v4.0.0-rc2 实测跑通，同时兼容 MatrixOne v3.0.11。
-- 运行：mysql -h <host> -P 6001 -u '<account>:admin:accountadmin' -p'<pwd>' --force < git4data_workbook.sql
-- 说明：价格用 INT「分」存，规避 4.0 的「小数减整数得负数→Decimal128 溢出」bug。
-- =====================================================================
DROP DATABASE IF EXISTS git4data_demo;
CREATE DATABASE git4data_demo;
USE git4data_demo;

CREATE TABLE price_list(
  product_id BIGINT PRIMARY KEY,
  name       VARCHAR(40),
  price_cents INT
);
INSERT INTO price_list VALUES
 (1,'智能手表',129900),(2,'蓝牙耳机',39900),(3,'登山背包',59900),(4,'跑步鞋',69900);


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 1. 快照 Snapshot：给当前数据打个版本（≈ git commit/tag）=====' AS step;
DROP SNAPSHOT IF EXISTS price_v1;
CREATE SNAPSHOT price_v1 FOR TABLE git4data_demo price_list;
SHOW SNAPSHOTS WHERE SNAPSHOT_NAME = 'price_v1';


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 2. 误操作：改错价 + 误删一行 =====' AS step;
UPDATE price_list SET price_cents = price_cents * 10 WHERE product_id = 1;  -- 手表价格被放大10倍
DELETE FROM price_list WHERE product_id = 2;                                -- 耳机被误删
SELECT * FROM price_list ORDER BY product_id;


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 3. 时间旅行 Time-Travel：直接读历史版本 {snapshot=...} =====' AS step;
SELECT * FROM price_list {snapshot = 'price_v1'} ORDER BY product_id;


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 4. 版本对比 Diff：历史 vs 当前，定位每处变化 =====' AS step;
SELECT old.product_id, old.name,
       old.price_cents AS `历史价`,
       cur.price_cents AS `当前价`,
       CASE WHEN cur.product_id IS NULL THEN '被删除'
            WHEN cur.price_cents <> old.price_cents THEN '被改价'
            ELSE '未变' END AS `变化`
FROM price_list {snapshot = 'price_v1'} old
LEFT JOIN price_list cur ON old.product_id = cur.product_id
ORDER BY old.product_id;


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 5. 克隆 Clone：从快照拉一份独立副本（审计/测试用，不动主表）=====' AS step;
DROP TABLE IF EXISTS price_list_v1;
CREATE TABLE price_list_v1 CLONE price_list {snapshot = 'price_v1'};
SELECT * FROM price_list_v1 ORDER BY product_id;


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 6. 回滚 Restore：把主表还原到 price_v1 =====' AS step;
-- 方式A（官方一键回滚，需账户名）：MatrixOne 3.0.11 可用；
--        OmniFabric 4.0 当前 RESTORE 解析失败，故默认注释，按需在 3.0.x 上启用。
--   RESTORE ACCOUNT `<account>` DATABASE git4data_demo TABLE price_list FROM SNAPSHOT price_v1;
-- 方式B（通用，靠快照读重建，任何版本都可用）：
DELETE FROM price_list;
INSERT INTO price_list SELECT * FROM price_list {snapshot = 'price_v1'};
SELECT * FROM price_list ORDER BY product_id;   -- 手表价复原、耳机回来了


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 7. PITR：开启连续时间点恢复（保留期内可回到任意时刻）=====' AS step;
DROP PITR IF EXISTS price_pitr;
CREATE PITR price_pitr FOR DATABASE git4data_demo RANGE 7 'd';
SHOW PITR WHERE PITR_NAME = 'price_pitr';


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 8. 数据分支 Data Branch：拉「促销提案」分支（与主表完全独立）=====' AS step;
-- ⚠️ 若在 Cloud Web 控制台执行单条 DATA BRANCH CREATE 会因注入注释失败；
--    用命令行执行本文件即可，或在它前面垫一条 SELECT 1;。
DATA BRANCH CREATE TABLE price_promo FROM price_list;
-- 在分支上改：手表打8折、上新福袋、下架背包（主表不受影响）
UPDATE price_promo SET price_cents = price_cents * 8 / 10 WHERE product_id = 1;
INSERT INTO price_promo VALUES (9,'促销福袋',9900);
DELETE FROM price_promo WHERE product_id = 3;


SELECT '===== 9. 分支差异 DIFF：提案相对主表改了什么（全列逐行）=====' AS step;
DATA BRANCH DIFF price_promo AGAINST price_list;

SELECT '===== 10. 差异概览 DIFF OUTPUT SUMMARY（增/删/改计数）=====' AS step;
DATA BRANCH DIFF price_promo AGAINST price_list OUTPUT SUMMARY;


-- ───────────────────────────────────────────────────────────────────
SELECT '===== 11. 合并 MERGE：把提案合并回主表（冲突取分支值）=====' AS step;
DATA BRANCH MERGE price_promo INTO price_list WHEN CONFLICT ACCEPT;
SELECT * FROM price_list ORDER BY product_id;   -- 手表8折、福袋上新、背包下架


-- ───────────────────────────────────────────────────────────────────
-- 清理（按需打开）：
-- DROP SNAPSHOT price_v1; DROP PITR price_pitr; DROP DATABASE git4data_demo;
SELECT '== Git for Data Workbook 跑完 ==' AS done;
