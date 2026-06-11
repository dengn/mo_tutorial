-- =====================================================================
-- MatrixOne 能力演示 · 00 基础库与种子数据
-- 场景：「MO 智选商城」—— 一个带智能检索的电商 + 知识库平台
-- 共享维度表：accounts(钱包) / products(商品+向量+全文) / inventory(库存) / assets(非结构化资产)
-- =====================================================================

-- 先清理可能遗留的快照/PITR/Stage/Task，避免阻塞重建
DROP SNAPSHOT IF EXISTS prod_v1;
DROP PITR     IF EXISTS demo_pitr;
DROP STAGE    IF EXISTS local_stage;
DROP STAGE    IF EXISTS oss_stage;
DROP TASK     IF EXISTS sales_rollup_task;

DROP DATABASE IF EXISTS mo_demo;
CREATE DATABASE mo_demo;
USE mo_demo;

-- 开启实验特性（向量索引 / 全文索引）
SET experimental_fulltext_index = 1;
SET experimental_hnsw_index = 1;
SET experimental_ivf_index = 1;

-- ---------------------------------------------------------------------
-- 1) 账户钱包表（事务演示用）
-- ---------------------------------------------------------------------
CREATE TABLE accounts (
  acct_id   INT PRIMARY KEY,
  user_name VARCHAR(32) NOT NULL,
  balance   DECIMAL(12,2) NOT NULL CHECK (balance >= 0),  -- 余额不能为负
  updated_at DATETIME
);
INSERT INTO accounts VALUES
 (1,'张伟', 8000.00, NULL),
 (2,'李娜', 5000.00, NULL),
 (3,'王芳',12000.00, NULL),
 (4,'刘强',  300.00, NULL),   -- 余额很低，用于演示余额不足回滚
 (5,'陈静', 6000.00, NULL);

-- ---------------------------------------------------------------------
-- 2) 商品表：标量字段 + 全文描述 + 向量 embedding
--    embedding 4 维语义：[科技感, 运动属性, 户外属性, 高端定位]，取值 0~1
-- ---------------------------------------------------------------------
CREATE TABLE products (
  product_id  BIGINT PRIMARY KEY,          -- BIGINT 以支持 HNSW 向量索引
  name        VARCHAR(64) NOT NULL,
  category    VARCHAR(16) NOT NULL,
  brand       VARCHAR(16),
  price       DECIMAL(10,2) NOT NULL,
  description TEXT,
  embedding   VECF32(4)
);
INSERT INTO products VALUES
 (101,'智能手表 Pro 旗舰版','电子','极客',1299.00,'高清触屏智能手表，支持50米防水、心率血氧监测、超长续航14天，运动模式丰富','[0.92,0.80,0.30,0.75]'),
 (102,'无线蓝牙运动耳机','电子','极客', 399.00,'入耳式蓝牙运动耳机，IPX7级防水防汗，低延迟，续航30小时，跑步健身专用','[0.82,0.90,0.20,0.40]'),
 (103,'4K高清航拍无人机','电子','天眼',3999.00,'4K高清航拍无人机，三轴云台增稳，35分钟超长续航，户外旅行航拍利器','[0.95,0.30,0.88,0.92]'),
 (104,'专业登山背包50L','户外','山野', 599.00,'50升大容量专业登山背包，防泼水面料，多隔层设计，承重透气背负系统','[0.10,0.55,0.95,0.55]'),
 (105,'轻量竞速跑步鞋','运动','疾风', 699.00,'轻量缓震竞速跑步鞋，高回弹中底，透气网面，马拉松训练与比赛适用','[0.12,0.95,0.40,0.55]'),
 (106,'机械键盘RGB背光','电子','极客', 459.00,'104键RGB背光机械键盘，热插拔轴体，全键无冲，游戏办公两用','[0.90,0.12,0.05,0.50]'),
 (107,'双人自动露营帐篷','户外','山野', 899.00,'双人自动速开露营帐篷，3000mm防水防风，户外野营装备','[0.06,0.30,0.92,0.62]'),
 (108,'智能体脂秤','电子','极客', 159.00,'智能体脂秤蓝牙连接APP，监测体重体脂率等多项身体数据，健身减脂必备','[0.70,0.72,0.12,0.30]'),
 (109,'户外防水冲锋衣','户外','山野', 799.00,'三合一户外防水冲锋衣，防风保暖透气，可拆卸内胆，登山徒步滑雪适用','[0.12,0.62,0.86,0.62]'),
 (110,'主动降噪头戴耳机','电子','声学',1099.00,'主动降噪头戴式耳机，Hi-Res音质，40小时续航，佩戴舒适，通勤旅行','[0.86,0.22,0.10,0.72]');

-- ---------------------------------------------------------------------
-- 3) 库存表（事务演示用：下单同时扣库存）
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
  product_id INT PRIMARY KEY,
  stock      INT NOT NULL CHECK (stock >= 0)
);
INSERT INTO inventory VALUES
 (101,120),(102,300),(103,45),(104,80),(105,200),
 (106,150),(107,60),(108,400),(109,110),(110,90);

-- ---------------------------------------------------------------------
-- 4) 订单 / 订单明细（事务演示用，初始为空，靠交易写入）
-- ---------------------------------------------------------------------
CREATE TABLE orders (
  order_id     INT PRIMARY KEY,
  acct_id      INT NOT NULL,
  order_time   DATETIME NOT NULL,
  status       VARCHAR(16) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL
);
CREATE TABLE order_items (
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  qty        INT NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- ---------------------------------------------------------------------
-- 5) 销售事实表（分析演示用，用 generate_series 批量造数）
-- ---------------------------------------------------------------------
CREATE TABLE sales (
  sale_id    INT PRIMARY KEY,
  sale_date  DATE NOT NULL,
  acct_id    INT NOT NULL,
  product_id INT NOT NULL,
  qty        INT NOT NULL,
  unit_price DECIMAL(10,2),
  amount     DECIMAL(12,2)
);

-- 造 3000 行销售流水，时间跨度 2025-12-01 ~ 2026-05-29（半年）
-- 用确定性取模分布把流水均匀打散到不同日期/账户/商品/数量（结果可复现）
INSERT INTO sales (sale_id, sale_date, acct_id, product_id, qty)
SELECT
  sale_id,
  DATE_ADD('2025-12-01', INTERVAL day_off DAY) AS sale_date,
  acct_id, product_id, qty
FROM (
  SELECT
    g.result                AS sale_id,
    (g.result * 11) % 180   AS day_off,
    1   + ((g.result * 3)  % 5)  AS acct_id,
    101 + ((g.result * 7)  % 10) AS product_id,
    1   + ((g.result * 13) % 3)  AS qty
  FROM generate_series(1, 3000) g
) t;

-- 回填单价与金额（join 商品价格）
UPDATE sales s JOIN products p ON s.product_id = p.product_id
SET s.unit_price = p.price,
    s.amount     = p.price * s.qty;

-- ---------------------------------------------------------------------
-- 6) 非结构化资产元数据表（stage 演示用：datalink 指向 stage 上的文件）
-- ---------------------------------------------------------------------
CREATE TABLE assets (
  asset_id   INT PRIMARY KEY,
  product_id INT,
  asset_type VARCHAR(16),         -- manual / image / spec
  file_name  VARCHAR(128),
  file_link  DATALINK             -- 指向 stage 上的非结构化文件
);

-- ---------------------------------------------------------------------
-- 7) 在 products 上建向量索引(HNSW) + 全文索引(ngram)，供能力四/五使用
-- ---------------------------------------------------------------------
CREATE INDEX idx_prod_vec USING HNSW ON products(embedding) OP_TYPE 'vector_l2_ops';
CREATE FULLTEXT INDEX idx_prod_ft ON products(description) WITH PARSER ngram;

SELECT '== 基础数据装载完成 ==' AS info;
SELECT (SELECT COUNT(*) FROM products)  AS products,
       (SELECT COUNT(*) FROM accounts)  AS accounts,
       (SELECT COUNT(*) FROM inventory) AS inventory,
       (SELECT COUNT(*) FROM sales)     AS sales_rows;
