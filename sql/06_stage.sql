-- =====================================================================
-- 能力六：Stage + 非结构化数据管理（云上版 · 对象存储）
-- Stage 指向对象存储（腾讯云 COS，S3 兼容），datalink 列管理文件引用，
-- save_file()/load_file() 在 SQL 里写入/读取非结构化文件内容，并与结构化数据 JOIN。
-- 已在云端 v3.0.11 + 腾讯云 COS 实测跑通。
--
-- ⚠️ 运行前请把下方 CREDENTIALS 换成你自己的对象存储凭据（S3 / 阿里云 OSS / 腾讯云 COS 均可）。
--    切勿把真实 AK/SK 提交到代码库；建议用仅对该 bucket 读写的子账号 AK。
--
-- 注：云上不要用 file:// 本地 stage —— 那会写到集群节点的临时磁盘，非持久、跨节点不可靠。
-- 建议执行： mysql ... --force < 06_stage.sql
-- =====================================================================
USE mo_demo;

SELECT '===== 1. Stage 生命周期管理（指向对象存储 COS）=====' AS step;
DROP STAGE IF EXISTS cos_stage;
CREATE STAGE cos_stage
  URL='s3://<your-bucket>/mo-demo/'                 -- 换成你的 bucket 与路径
  CREDENTIALS={
    'AWS_KEY_ID'='<YOUR_ACCESS_KEY_ID>',
    'AWS_SECRET_KEY'='<YOUR_SECRET_ACCESS_KEY>',
    'AWS_REGION'='ap-shanghai',                     -- 你的 region
    'ENDPOINT'='cos.ap-shanghai.myqcloud.com',      -- 腾讯云COS示例；OSS如 oss-cn-hangzhou.aliyuncs.com
    'PROVIDER'='cos',                               -- 腾讯云COS用'cos'；阿里云OSS/AWS S3相应调整
    'COMPRESSION'='none'
  }
  ENABLE=TRUE
  COMMENT='演示用对象存储stage';
SHOW STAGES LIKE 'cos_stage';


SELECT '===== 2. 把非结构化文件（商品手册）写入对象存储（save_file）=====' AS step;
-- 注：save_file 不会覆盖已存在对象；重复运行会报 already exists（--force 下可忽略，下方读取仍正常）。
SELECT save_file(cast('stage://cos_stage/manual_101.txt' as datalink),
  '【智能手表 Pro 用户手册】50米防水；心率/血氧实时监测；续航14天；支持百余种运动模式。') AS `手表手册字节`;
SELECT save_file(cast('stage://cos_stage/manual_103.txt' as datalink),
  '【4K航拍无人机 用户手册】三轴云台增稳；35分钟续航；图传10公里；返航避障。注意：禁飞区请勿起飞。') AS `无人机手册字节`;
SELECT save_file(cast('stage://cos_stage/manual_104.txt' as datalink),
  '【专业登山背包50L 使用说明】防泼水面料；可调背负系统；建议负重不超过18kg。') AS `背包手册字节`;


SELECT '===== 3. 用 datalink 列在 assets 表统一登记非结构化资产 =====' AS step;
TRUNCATE TABLE assets;
INSERT INTO assets VALUES
 (1, 101, 'manual', 'manual_101.txt', cast('stage://cos_stage/manual_101.txt' as datalink)),
 (2, 103, 'manual', 'manual_103.txt', cast('stage://cos_stage/manual_103.txt' as datalink)),
 (3, 104, 'manual', 'manual_104.txt', cast('stage://cos_stage/manual_104.txt' as datalink));
SELECT asset_id AS `资产ID`, product_id AS `商品ID`, asset_type AS `类型`, file_name AS `文件名` FROM assets;


SELECT '===== 4. 一体化查询：结构化商品 JOIN 对象存储里的手册内容（load_file）=====' AS step;
SELECT
  p.name                 AS `商品`,
  p.price                AS `价格`,
  a.file_name            AS `手册文件`,
  load_file(a.file_link) AS `手册内容(从COS实时读取)`
FROM products p
JOIN assets a ON p.product_id = a.product_id
ORDER BY p.product_id;


SELECT '===== 5. Stage 治理：禁用 / 启用 / 查看状态 =====' AS step;
ALTER STAGE cos_stage SET ENABLE=FALSE;            -- 临时停用该数据源
SHOW STAGES LIKE 'cos_stage';
ALTER STAGE cos_stage SET ENABLE=TRUE;             -- 重新启用
SHOW STAGES LIKE 'cos_stage';


-- 收尾：保留 cos_stage 与 assets 供查看；如需清理：
-- DROP STAGE IF EXISTS cos_stage;
SELECT '== Stage 非结构化数据管理演示完成（对象存储 COS）==' AS done;
