-- =====================================================================
-- 能力二：分析能力 (OLAP)
-- 基于 3000 行销售流水 sales，演示分组聚合 / 窗口函数 / CTE / 多维汇总
-- 同时附带一条对内置 TPCH SF1（约 600 万行）的大数据量聚合，体现列存分析性能
-- =====================================================================
USE mo_demo;

SELECT '===== 1. 品类销售概览 + 占比窗口 =====' AS step;
SELECT
  p.category                                              AS `品类`,
  COUNT(*)                                                AS `订单数`,
  SUM(s.qty)                                              AS `销量`,
  SUM(s.amount)                                           AS `销售额`,
  ROUND(SUM(s.amount) * 100.0 / SUM(SUM(s.amount)) OVER (), 2) AS `销售额占比%`
FROM sales s JOIN products p ON s.product_id = p.product_id
GROUP BY p.category
ORDER BY `销售额` DESC;


SELECT '===== 2. 单品销售额排行（RANK 窗口函数）=====' AS step;
SELECT
  RANK() OVER (ORDER BY SUM(s.amount) DESC) AS `排名`,
  p.name                                    AS `商品`,
  p.category                                AS `品类`,
  SUM(s.qty)                                AS `销量`,
  SUM(s.amount)                             AS `销售额`
FROM sales s JOIN products p ON s.product_id = p.product_id
GROUP BY p.product_id, p.name, p.category
ORDER BY `排名`;


SELECT '===== 3. 月度销售趋势 + 环比增长（LAG 窗口函数）=====' AS step;
WITH monthly AS (
  SELECT DATE_FORMAT(sale_date, '%Y-%m') AS ym, SUM(amount) AS rev
  FROM sales GROUP BY DATE_FORMAT(sale_date, '%Y-%m')
)
SELECT
  ym                                                            AS `月份`,
  rev                                                           AS `销售额`,
  LAG(rev) OVER (ORDER BY ym)                                   AS `上月销售额`,
  ROUND((rev - LAG(rev) OVER (ORDER BY ym))
        * 100.0 / LAG(rev) OVER (ORDER BY ym), 2)               AS `环比增长%`,
  SUM(rev) OVER (ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS `累计销售额`
FROM monthly
ORDER BY ym;


SELECT '===== 4. 用户消费分层 + 品类内排名（PARTITION BY 窗口）=====' AS step;
SELECT
  a.user_name                                                          AS `用户`,
  p.category                                                           AS `品类`,
  SUM(s.amount)                                                        AS `该品类消费`,
  RANK() OVER (PARTITION BY p.category ORDER BY SUM(s.amount) DESC)     AS `品类内排名`
FROM sales s
JOIN accounts a ON s.acct_id = a.acct_id
JOIN products p ON s.product_id = p.product_id
GROUP BY a.user_name, p.category
ORDER BY p.category, `品类内排名`;


SELECT '===== 5. 多维汇总：品类×月份 含小计与总计（WITH ROLLUP）=====' AS step;
SELECT
  COALESCE(p.category, '【全部品类】')              AS `品类`,
  COALESCE(DATE_FORMAT(s.sale_date,'%Y-%m'),'【合计】') AS `月份`,
  SUM(s.amount)                                      AS `销售额`
FROM sales s JOIN products p ON s.product_id = p.product_id
GROUP BY p.category, DATE_FORMAT(s.sale_date,'%Y-%m') WITH ROLLUP
ORDER BY `品类`, `月份`;


SELECT '===== 6. 大数据量分析：TPCH SF1 lineitem（约 600 万行）TPC-H Q1 风格聚合 =====' AS step;
SELECT
  l_returnflag                       AS `退货标志`,
  l_linestatus                       AS `状态`,
  COUNT(*)                           AS `行数`,
  ROUND(SUM(l_quantity),0)           AS `总数量`,
  ROUND(SUM(l_extendedprice),0)      AS `总金额`,
  ROUND(AVG(l_discount),4)           AS `平均折扣`
FROM mo_sample_data_tpch_sf1.lineitem
WHERE l_shipdate <= DATE '1998-09-01'
GROUP BY l_returnflag, l_linestatus
ORDER BY l_returnflag, l_linestatus;
