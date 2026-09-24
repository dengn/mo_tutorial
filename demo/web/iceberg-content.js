const ns=d=>d?.namespace||'<本次 namespace>';
const ref=d=>d?.history_ref||'<保存四行状态的 Nessie 分支>';
export const ICEBERG_STAGES=[
  {id:'services',title:'准备两个外部服务',kind:'Shell / 服务探测',explain:'MinIO 提供 S3 兼容存储，保存数据文件和元数据文件；Nessie 提供 Iceberg REST Catalog，按表名找到当前元数据。MatrixOne 是执行 SQL 的计算引擎。本步只启动和检查服务，还没有湖表。',observe:'Nessie 返回 REST 配置，MinIO 的 mo-iceberg bucket 可以访问。',code:()=>`# 在 MatrixOne v4.2.4 源码目录执行
make dev-up-iceberg-tier-a
# 检查 Catalog 与存储；这些不是 SQL
GET http://127.0.0.1:19120/iceberg/v1/config
GET http://127.0.0.1:9000/mo-iceberg?list-type=2&max-keys=1`},
  {id:'lake',title:'先在湖上创建空表',kind:'Iceberg REST API',explain:'namespace 是湖上的命名空间，类似数据库中的分组。通过 REST API 创建 append_orders，定义列 ID、列类型和存储位置。此时有表元数据，尚无订单行，也尚未建立 MatrixOne 外表。',observe:'Catalog 返回四列定义和 metadata-location；对象存储中能看到元数据文件。',code:d=>`# prefix 来自 GET /iceberg/v1/config
POST /iceberg/v1/{prefix}/namespaces
${JSON.stringify({namespace:[ns(d)],properties:{owner:'matrixone-demo'}},null,2)}
POST /iceberg/v1/{prefix}/namespaces/${ns(d)}/tables
${JSON.stringify({name:'append_orders','stage-create':false,schema:{type:'struct','schema-id':0,fields:[{id:1,name:'order_id',required:true,type:'long'},{id:2,name:'bucket',required:false,type:'int'},{id:3,name:'amount',required:false,type:'long'},{id:4,name:'region',required:false,type:'string'}]},'partition-spec':{'spec-id':0,fields:[]},location:`s3://mo-iceberg/warehouse/${ns(d)}/append_orders`,properties:{'format-version':'2','history.expire.min-snapshots-to-keep':'2'}},null,2)}`},
  {id:'mapping',title:'让 MatrixOne 认识湖表',kind:'MatrixOne SQL',explain:'demo_story_ice 是 MatrixOne 内保存的 Catalog 连接名；访问注册指定本地外部身份与存储范围。CREATE EXTERNAL TABLE 再把本地 SQL 表名映射到湖上的 namespace / table / ref。创建映射不复制订单行。',observe:'SHOW CREATE TABLE 显示映射；湖表尚无快照。本机 v4.2.4 在首次写入前 SELECT 会报 snapshot ref not found，下一步先写数据。',code:d=>`CREATE DATABASE demo_story_lake;
CREATE ICEBERG CATALOG IF NOT EXISTS demo_story_ice WITH (
  'type'='rest','uri'='http://127.0.0.1:19120/iceberg',
  'warehouse'='s3://mo-iceberg/warehouse','auth_mode'='none');
CALL iceberg_register_access('demo_story_ice',
  'scope=cluster,account_id=0,external_principal=ci-local,endpoint=localhost,region=us-east-1,bucket=mo-iceberg');
CREATE EXTERNAL TABLE demo_story_lake.append_orders (
  order_id BIGINT,bucket INT,amount BIGINT,region TEXT
) ENGINE=ICEBERG WITH (
  'catalog'='demo_story_ice','namespace'='${ns(d)}',
  'table'='append_orders','ref'='main',
  'read_mode'='append_only','write_mode'='append_only');
SHOW CREATE TABLE demo_story_lake.append_orders;
-- 尚无数据快照；先执行下一步 INSERT，再 SELECT。`},
  {id:'write',title:'写入四笔订单',kind:'MatrixOne SQL',explain:'INSERT 通过 Iceberg 外表写入湖上的数据文件，并提交新的表快照。订单没有被导入 MatrixOne 普通业务表。bucket 是本例普通整型列；这张表的 partition-spec 为空，不能把列名当作分桶分区。',observe:'SQL 返回 4 行、金额 100；REST 元数据出现快照 ID，存储中出现 Parquet 和 Avro 文件。',code:()=>`INSERT INTO demo_story_lake.append_orders VALUES
  (1,1,10,'ksa'),(2,1,20,'uae'),(3,2,30,'ksa'),(4,2,40,'qat');
SELECT order_id,bucket,amount,region FROM demo_story_lake.append_orders ORDER BY order_id;
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders; -- 4 / 100`},
  {id:'history',title:'保存追加前的历史入口',kind:'Nessie API + MatrixOne SQL',explain:'记录四行时的 Iceberg snapshot ID。再用 Nessie API 从 main 当前提交创建一个分支，让它保留该 Catalog 状态；Nessie 分支名与 Iceberg 表快照 ID 是两个概念。append_orders_old 是我们手动创建的第二个本地外表名，仍映射同一湖表，但 ref 改为历史分支。',observe:'两个本地外表此时都读到相同四行；历史分支名和快照 ID 会显示在下方。',code:d=>`GET /api/v1/trees/tree/main
# 将返回的 hash 填入，创建 Nessie Catalog 分支
POST /api/v1/trees/tree
{"type":"BRANCH","name":"${ref(d)}","hash":"<main 返回的提交 hash>"}

-- 以下由 MatrixOne 执行
CREATE EXTERNAL TABLE demo_story_lake.append_orders_old (
  order_id BIGINT,bucket INT,amount BIGINT,region TEXT
) ENGINE=ICEBERG WITH (
  'catalog'='demo_story_ice','namespace'='${ns(d)}',
  'table'='append_orders','ref'='${ref(d)}',
  'read_mode'='append_only','write_mode'='append_only');`},
  {id:'append',title:'再写一笔，对照两个状态',kind:'MatrixOne SQL',explain:'只向 main 映射追加订单 #5，金额 50。main 指向新的表状态，历史分支保持不动。最后按真实 snapshot ID 查询历史映射，比较订单 ID 与金额。',observe:'当前 5 行 / 150，历史 4 行 / 100；差异恰好是订单 #5。',code:d=>`INSERT INTO demo_story_lake.append_orders VALUES (5,3,50,'ksa');
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders;
SELECT COUNT(*),SUM(amount) FROM demo_story_lake.append_orders_old
FOR ICEBERG SNAPSHOT ${d?.old_snapshot||'<四行时的 snapshot ID>'};`},
];
export const ICEBERG_ROLES=[
  ['计算引擎 / MatrixOne','你提交 SELECT 或 INSERT 的地方。它从 Catalog 解析表的元数据，再读写对象存储里的文件。本例已启用 Iceberg 读写配置。'],
  ['表目录 / Nessie','把 namespace + table + ref 解析为表元数据位置，并协调元数据提交。这里使用 REST Catalog；Nessie 分支属于 Catalog 版本管理。'],
  ['表格式 / Iceberg','定义 schema、快照和文件清单怎样组织。metadata JSON 指向快照的 manifest list，清单再描述该状态需要的数据文件。它本身不负责执行 SQL。'],
  ['对象存储 / MinIO','保存实际的 Parquet 数据文件、Avro 清单和 JSON 元数据文件。S3 兼容地址 s3://mo-iceberg/... 中，mo-iceberg 是 bucket。'],
];
