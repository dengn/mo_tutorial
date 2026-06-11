-- =====================================================================
-- 能力五：混合查询（结构化 + 向量 + 全文 的多路联合检索）
-- 1) 向量 + 标量过滤      2) 全文 + 标量 + 向量排序（一条 SQL 三路信号）
-- 3) RRF 倒数排名融合（关键词召回 ⊕ 语义召回，典型 Hybrid Search）
-- 建议执行： mysql ... mo_demo --force < 05_hybrid.sql
-- =====================================================================
USE mo_demo;
SET experimental_hnsw_index = 1;
SET experimental_fulltext_index = 1;


SELECT '===== 1. 向量 + 标量过滤：电子类、价格≤800，且语义最接近「智能运动装备」=====' AS step;
SELECT
  name                                                      AS `商品`,
  category                                                  AS `品类`,
  price                                                     AS `价格`,
  ROUND(l2_distance(embedding, '[0.85,0.88,0.20,0.50]'), 4) AS `语义距离`
FROM products
WHERE category = '电子' AND price <= 800              -- 结构化过滤
ORDER BY l2_distance(embedding, '[0.85,0.88,0.20,0.50]')  -- 向量语义排序
LIMIT 5;


SELECT '===== 2. 三路信号一条 SQL：全文命中「防水」 + 价格<1000 + 按户外语义向量排序 =====' AS step;
SELECT
  name                                                      AS `商品`,
  price                                                     AS `价格`,
  ROUND(l2_distance(embedding, '[0.10,0.55,0.92,0.58]'), 4) AS `户外语义距离`
FROM products
WHERE MATCH(description) AGAINST('防水')              -- 全文检索（命中关键词）
  AND price < 1000                                    -- 结构化过滤
ORDER BY l2_distance(embedding, '[0.10,0.55,0.92,0.58]')  -- 向量语义排序
LIMIT 5;


SELECT '===== 3. RRF 混合检索：关键词召回 ⊕ 向量语义召回，倒数排名融合 =====' AS step;
-- 说明：MATCH 评分投影/联表受优化器限制，故先把两路召回各自物化为普通表，再做纯关系融合。
--       关键词侧名次按「销量热度」排序（真实业务信号）；语义侧名次按向量距离。
--       RRF(d) = Σ 1/(k + rank_i(d))，k=60；同时命中两路的商品会被显著提权。
DROP TABLE IF EXISTS _kw;
DROP TABLE IF EXISTS _sem;
CREATE TABLE _kw(product_id BIGINT);
CREATE TABLE _sem(product_id BIGINT, sem_rank INT, dist DOUBLE);

-- 关键词召回（MATCH 仅出现在 WHERE）
INSERT INTO _kw
  SELECT product_id FROM products
  WHERE MATCH(description) AGAINST('防水 运动 健身' IN BOOLEAN MODE);

-- 向量语义召回 top-6（按 L2 距离）
INSERT INTO _sem(product_id, dist, sem_rank)
  SELECT product_id, dist, ROW_NUMBER() OVER (ORDER BY dist)
  FROM (
    SELECT product_id, l2_distance(embedding, '[0.85,0.88,0.20,0.50]') AS dist
    FROM products ORDER BY dist LIMIT 6
  ) t;

-- 融合：两路候选取并集，各自 1/(60+名次) 相加
WITH cand AS (SELECT product_id FROM _kw UNION SELECT product_id FROM _sem),
kw AS (
  SELECT k.product_id,
         ROW_NUMBER() OVER (ORDER BY COUNT(s.sale_id) DESC, k.product_id) AS kw_rank
  FROM _kw k LEFT JOIN sales s ON k.product_id = s.product_id
  GROUP BY k.product_id
)
SELECT
  p.name                                                                  AS `商品`,
  kw.kw_rank                                                              AS `关键词名次`,
  sem.sem_rank                                                            AS `语义名次`,
  ROUND(COALESCE(1.0/(60+kw.kw_rank),0) + COALESCE(1.0/(60+sem.sem_rank),0), 6) AS `RRF融合分`
FROM cand c
JOIN products p   ON c.product_id = p.product_id
LEFT JOIN kw      ON c.product_id = kw.product_id
LEFT JOIN _sem sem ON c.product_id = sem.product_id
ORDER BY `RRF融合分` DESC
LIMIT 8;

DROP TABLE IF EXISTS _kw;
DROP TABLE IF EXISTS _sem;
