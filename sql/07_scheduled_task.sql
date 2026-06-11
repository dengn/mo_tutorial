-- =====================================================================
-- 能力七：任务调度（MatrixOne 原生 SQL Task）
-- 用 CREATE TASK ... SCHEDULE '<cron>' AS BEGIN ... END 在库内定义定时作业，
-- 由 MatrixOne 自身调度执行；配套 EXECUTE / SHOW TASKS / SHOW TASK RUNS /
-- ALTER TASK SUSPEND|RESUME / DROP TASK 管理整个生命周期。
-- 文档：https://docs.matrixorigin.cn/.../Data-Definition-Language/sql-task/
-- 注意：任务体含分号，必须用 DELIMITER 改写终止符；请用「文件」方式执行：
--   mysql ... < 07_scheduled_task.sql      （不要用 -e 单条传入）
-- =====================================================================
USE mo_demo;

SELECT '===== 1. 建立作业目标表（销售日汇总）=====' AS step;
CREATE TABLE IF NOT EXISTS sales_daily_summary (
  summary_date DATE PRIMARY KEY,
  order_cnt    INT,
  total_qty    INT,
  total_amount DECIMAL(14,2),
  refreshed_at DATETIME
);

SELECT '===== 2. 定义定时任务：每天 02:00(UTC) 幂等刷新销售日汇总 =====' AS step;
DROP TASK IF EXISTS sales_rollup_task;

DELIMITER $$
CREATE TASK sales_rollup_task
  SCHEDULE '0 0 2 * * *'          -- robfig/cron v3 六段式：秒 分 时 日 月 周（每天 02:00:00）
  TIMEZONE 'Asia/Shanghai'
  RETRY 1                          -- 失败后额外重试 1 次
  TIMEOUT '5m'                     -- 单次执行超时
AS BEGIN
  -- 全限定表名：调度执行时不依赖会话默认库
  INSERT INTO mo_demo.sales_daily_summary
    (summary_date, order_cnt, total_qty, total_amount, refreshed_at)
  SELECT sale_date, COUNT(*), SUM(qty), SUM(amount), now()
  FROM mo_demo.sales
  GROUP BY sale_date
  ON DUPLICATE KEY UPDATE
    order_cnt    = VALUES(order_cnt),
    total_qty    = VALUES(total_qty),
    total_amount = VALUES(total_amount),
    refreshed_at = VALUES(refreshed_at);
END $$
DELIMITER ;

SELECT '===== 3. 手动立即触发一次（EXECUTE TASK），无需等到排程时间 =====' AS step;
EXECUTE TASK sales_rollup_task;

SELECT '===== 4. 查看任务定义与状态（SHOW TASKS）=====' AS step;
SHOW TASKS;

SELECT '===== 5. 查看执行历史（SHOW TASK RUNS：触发方式/状态/耗时/影响行数）=====' AS step;
SHOW TASK RUNS FOR sales_rollup_task LIMIT 10;

SELECT '===== 6. 作业产出：销售日汇总（最近 7 天）=====' AS step;
SELECT summary_date AS `日期`, order_cnt AS `订单数`, total_qty AS `销量`,
       total_amount AS `销售额`, refreshed_at AS `刷新时间`
FROM mo_demo.sales_daily_summary
ORDER BY summary_date DESC
LIMIT 7;

SELECT '===== 7. 任务治理：暂停 / 恢复 / 改排程 =====' AS step;
ALTER TASK sales_rollup_task SUSPEND;                       -- 暂停调度
SHOW TASKS;
ALTER TASK sales_rollup_task RESUME;                        -- 恢复调度
-- 改成每分钟执行（演示用，可观察自动触发）：
-- ALTER TASK sales_rollup_task SET SCHEDULE '0 * * * * *' TIMEZONE 'Asia/Shanghai';

-- 收尾：保留任务供查看；如需删除：
-- DROP TASK IF EXISTS sales_rollup_task;
SELECT '== 任务调度演示完成（原生 SQL Task）==' AS done;
