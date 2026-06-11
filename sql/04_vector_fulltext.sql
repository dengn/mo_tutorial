-- =====================================================================
-- 能力四：向量检索 + 全文检索
-- 在 products 上：embedding(4维) 建 HNSW 向量索引；description 建 ngram 全文索引
-- 向量语义维度：[科技感, 运动属性, 户外属性, 高端定位]
-- 建议执行： mysql ... mo_demo --force < 04_vector_fulltext.sql
-- =====================================================================
USE mo_demo;
SET experimental_hnsw_index = 1;
SET experimental_fulltext_index = 1;

-- 索引已在 00_setup.sql 中创建（HNSW 向量索引 + ngram 全文索引）。这里查看一下：
SELECT '===== 0. products 上的向量/全文索引 =====' AS step;
SHOW INDEX FROM products WHERE Key_name <> 'PRIMARY';


SELECT '===== 1. 向量相似度检索：找「智能运动装备」最像的商品（L2 距离）=====' AS step;
-- 查询向量 = 高科技 + 强运动 + 弱户外 + 中端
SELECT
  name                                            AS `商品`,
  category                                        AS `品类`,
  ROUND(l2_distance(embedding, '[0.85,0.88,0.20,0.50]'), 4) AS `L2距离`
FROM products
ORDER BY l2_distance(embedding, '[0.85,0.88,0.20,0.50]')
LIMIT 5;


SELECT '===== 2. 向量相似度检索：找「户外徒步装备」最像的商品（余弦距离）=====' AS step;
-- 查询向量 = 弱科技 + 中运动 + 强户外
SELECT
  name                                                          AS `商品`,
  category                                                      AS `品类`,
  ROUND(cosine_distance(embedding, '[0.10,0.55,0.92,0.58]'), 4) AS `余弦距离`
FROM products
ORDER BY cosine_distance(embedding, '[0.10,0.55,0.92,0.58]')
LIMIT 5;


SELECT '===== 3. 全文检索：描述里包含「防水」的商品 + 相关度打分 =====' AS step;
-- 注意：MATCH()...AGAINST() 作为评分投影时不能再被 ROUND() 等函数包裹，否则优化器无法命中全文索引
SELECT
  name                                AS `商品`,
  MATCH(description) AGAINST('防水')  AS `相关度`,
  description                         AS `描述`
FROM products
WHERE MATCH(description) AGAINST('防水')
ORDER BY `相关度` DESC;


SELECT '===== 4. 全文检索（布尔模式）：必须同时包含「防水」和「续航」=====' AS step;
SELECT
  name        AS `商品`,
  description AS `描述`
FROM products
WHERE MATCH(description) AGAINST('+防水 +续航' IN BOOLEAN MODE);


SELECT '===== 5. 全文检索（布尔 OR）：包含「健身」或「续航」任一关键词 =====' AS step;
SELECT
  name        AS `商品`,
  description AS `描述`
FROM products
WHERE MATCH(description) AGAINST('健身 续航' IN BOOLEAN MODE);
