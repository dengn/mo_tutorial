-- =====================================================================
-- 清理：删除本演示创建的全部对象（库 / 快照 / PITR / Stage）
-- =====================================================================
DROP TASK     IF EXISTS sales_rollup_task;
DROP TABLE    IF EXISTS mo_demo.price_book_promo;
DROP TABLE    IF EXISTS mo_demo.price_book;
DROP SNAPSHOT IF EXISTS prod_v1;
DROP PITR     IF EXISTS demo_pitr;
DROP STAGE    IF EXISTS local_stage;
DROP STAGE    IF EXISTS oss_stage;
DROP DATABASE IF EXISTS mo_demo;
SELECT '== 已清理 mo_demo 及相关快照/PITR/Stage ==' AS done;
