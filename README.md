# MatrixOne 六大能力演示 · MO 智选商城

一套自包含的演示数据 + SQL，在一个「带智能检索的电商 + 知识库」场景下，分别展示 MatrixOne 的
**事务 / 分析 / Git for Data / 向量+全文 / 混合查询 / Stage 非结构化管理** 六大能力。

- 适用版本：MatrixOne `v3.0.11`+（MatrixOne Cloud 或自建均可）。
- 所有脚本均已在 MatrixOne Cloud `8.0.30-MatrixOne-v3.0.11` 上实际跑通。
- 连接信息用环境变量提供（见「快速开始」），文中示例以 `<host>` / `<account>` / `<password>` 占位。

## 目录

```
mo_demo/
├── run_all.sh              # 一键运行（或按编号单跑）
├── README.md               # 本文件
└── sql/
    ├── 00_setup.sql        # 建库 + 造数（共享维度 + 3000 行销售流水）
    ├── 01_transaction.sql  # 能力一：事务 ACID
    ├── 02_analytics.sql    # 能力二：OLAP 分析
    ├── 03_git4data.sql     # 能力三：数据版本管理
    ├── 04_vector_fulltext.sql # 能力四：向量检索 + 全文检索
    ├── 05_hybrid.sql       # 能力五：混合查询
    ├── 06_stage.sql        # 能力六：Stage + 非结构化数据
    ├── 07_scheduled_task.sql # 能力七：任务调度（原生 SQL Task）
    ├── 99_cleanup.sql      # 清理全部演示对象
    ├── tpch_sf10_queries.sql # 附：TPC-H 22 条查询（库 mo_sample_data_tpch_sf10）
    └── git4data_workbook.sql # 独立可跑的 Git-for-Data 完整示例（快照/时间旅行/Diff/克隆/回滚/PITR/数据分支）
```

## 快速开始

```bash
# 1) 设置连接信息（自建实例示例；MatrixOne Cloud 把 MO_USER 换成 '<account>:admin:accountadmin'）
export MO_HOST=127.0.0.1 MO_PORT=6001 MO_USER=root MO_PASS=111
# 2) 运行
bash run_all.sh          # 按 00→07 顺序全部执行
bash run_all.sh 04       # 只跑某一个能力
```

> 单独执行某个脚本时建议带 `--force`（部分演示故意触发约束/索引异常以展示行为）：
> ```bash
> mysql -h <host> -P 6001 -u '<account>:admin:accountadmin' -p'<password>' --force mo_demo < sql/04_vector_fulltext.sql
> ```
> 注意：**必须先跑 `00_setup.sql`**，后续脚本都依赖它建的库和数据。

## 数据模型

| 表 | 作用 | 关键列 |
|---|---|---|
| `accounts` | 用户钱包 | `balance DECIMAL CHECK(>=0)` |
| `products` | 商品目录 | `embedding VECF32(4)` + `description TEXT`（全文）+ `product_id BIGINT`（支持 HNSW） |
| `inventory` | 库存 | `stock CHECK(>=0)` |
| `orders` / `order_items` | 订单（事务写入） | |
| `sales` | 销售流水（3000 行，半年） | 分析用事实表 |
| `assets` | 非结构化资产登记 | `file_link DATALINK` |

商品向量 `embedding` 的 4 个维度语义为 **[科技感, 运动属性, 户外属性, 高端定位]**，取值 0~1，便于直观验证相似度。

## 六大能力一览

### 1. 事务能力（`01_transaction.sql`）
- **原子提交**：一笔下单 = 扣余额 + 扣库存 + 写订单 + 写明细，四表一致变更后 `COMMIT`。
- **主动回滚**：事务内可见改动，`ROLLBACK` 后外部无感知（隔离性 + 原子性）。
- **约束保护 + 失败回滚**：余额不足触发 `CHECK(balance>=0)`，整笔回滚，先扣的库存/订单一并撤销，**零脏数据**。

### 2. 分析能力（`02_analytics.sql`）
分组聚合、占比窗口、`RANK()`、`LAG()` 环比、累计窗口、`PARTITION BY` 分区排名、`WITH ROLLUP` 多维小计；
最后对内置 **TPC-H SF1（约 590 万行 lineitem）** 跑 Q1 风格聚合，体现列存大数据量分析性能。

### 3. Git for Data（`03_git4data.sql`）—— 两套互补机制
- **A. 快照 / 时间旅行 / 回滚**：`CREATE SNAPSHOT`（≈ commit/tag）→ 误改全场价格 → `{snapshot=...}` **时间旅行**读历史 → `RESTORE ... FROM SNAPSHOT` **一键回滚** → `CREATE PITR` 连续时间点恢复。
- **B. 数据分支 Data Branch**（≈ git branch/merge）：
  - `DATA BRANCH CREATE TABLE 提案分支 FROM 主表` 拉分支（与主表完全独立）；
  - 在分支上改价/上新/下架；
  - `DATA BRANCH DIFF 分支 AGAINST 主表` 看差异（全列逐行 INSERT/DELETE/UPDATE，或 `OUTPUT SUMMARY` 增删改计数 / `COLUMNS(...)` 投影）；
  - `DATA BRANCH MERGE 分支 INTO 主表 WHEN CONFLICT ACCEPT|SKIP|FAIL` 合并；
  - 分支血缘见 `mo_catalog.mo_branch_metadata`。
> ⚠️ `DATA BRANCH DIFF` 全列输出当前不支持 DECIMAL/向量列（报 `unsupported mysql type 0`），故分支演示用 INT「分」存价；含 DECIMAL 的表可用 `OUTPUT SUMMARY` 或 `COLUMNS(...)` 规避。
> ⚠️ v3.0.11：`DATA BRANCH CREATE` 若语句前带注释会报 `cannot find src and dst table`。MatrixOne Cloud **Web 控制台**会自动给每条语句加 `/* cloud_user */` 前缀，导致这一句在控制台里失败 —— **请用 mysql 命令行运行 `03_git4data.sql`**（DIFF/MERGE 不受影响）。

### 4. 向量 + 全文（`04_vector_fulltext.sql`）
- 向量：`HNSW` 索引 + `l2_distance` / `cosine_distance` 相似度 Top-K。
- 全文：`FULLTEXT ... WITH PARSER ngram`（中文）+ `MATCH ... AGAINST`，含自然语言、布尔模式、相关度打分。

### 5. 混合查询（`05_hybrid.sql`）
- 向量 + 标量过滤；
- 一条 SQL 三路信号：全文命中 + 价格过滤 + 向量语义排序；
- **RRF 倒数排名融合**：关键词召回 ⊕ 向量语义召回，同时命中两路的商品被显著提权（典型 Hybrid Search）。

### 6. Stage 非结构化数据管理（`06_stage.sql`）
`CREATE STAGE` 指向**对象存储**（演示用腾讯云 COS，S3 兼容）统一治理外部数据源；`save_file()` 把商品手册等非结构化文件写入对象存储；
`DATALINK` 列在 `assets` 表登记资产引用；`load_file()` 从对象存储实时读取文件内容并与结构化商品 JOIN，实现**结构化 + 非结构化一体化查询**；`ALTER STAGE SET ENABLE` 启停治理。
> ⚠️ 云上必须用对象存储 stage（S3/OSS/COS），**不要用 `file://` 本地 stage**——那会写到集群节点临时磁盘，非持久、跨节点不可靠。
> 运行 `06_stage.sql` 前，请把其中的 `CREDENTIALS`（`<YOUR_ACCESS_KEY_ID>` 等占位符）和 bucket 换成你自己的对象存储凭据。
> `save_file` 不覆盖已存在对象，重复运行会报 `already exists`（`--force` 下可忽略，`load_file`/JOIN 仍正常）。

### 7. 任务调度（`07_scheduled_task.sql`）—— MatrixOne 原生 SQL Task
用库内原生 DDL 定义定时作业，由 MatrixOne 自身调度执行（**已在云端 v3.0.11 实测自动触发**）：
```sql
CREATE TASK sales_rollup_task
  SCHEDULE '0 0 2 * * *'  TIMEZONE 'Asia/Shanghai'   -- cron 六段式：秒 分 时 日 月 周
  RETRY 1  TIMEOUT '5m'
AS BEGIN
  INSERT INTO mo_demo.sales_daily_summary (...) SELECT ... FROM mo_demo.sales GROUP BY sale_date
  ON DUPLICATE KEY UPDATE ...;        -- 幂等增量刷新
END;
EXECUTE TASK sales_rollup_task;       -- 手动立即触发
SHOW TASKS;                           -- 任务定义与状态
SHOW TASK RUNS FOR sales_rollup_task; -- 执行历史：触发方式/状态/耗时/影响行数
ALTER TASK sales_rollup_task SUSPEND; -- 暂停 / RESUME 恢复 / SET SCHEDULE 改排程
```
> **必须用文件方式执行**（`mysql ... < 07_scheduled_task.sql`）：任务体含分号，脚本用 `DELIMITER` 改写终止符；用 `-e` 单条传入会被客户端在分号处截断。
> 备注：MySQL 的 `CREATE EVENT` 不被支持（应改用 `CREATE TASK`）；`CREATE CDC` 是另一种「持续同步任务」，但云上免费版复合登录名 + 含 `@` 密码无法写进 CDC 连接 URI。

## 本版本（v3.0.11）实测要点（踩坑记录）

- 中文列别名需用反引号包裹：`AS \`销售额\``。
- `generate_series(a,b)` 列名为 `result`；`rand()` 不接受整型种子（造数用确定性取模分布）。
- 全文索引：中文需 `WITH PARSER ngram`；**`MATCH()...AGAINST()` 作为评分投影时不能再被 `ROUND()` 等函数包裹**，且不能出现在 `INSERT...SELECT` 或与其它表 JOIN 的多 CTE 里（否则报 *full table scan with fulltext search not supported*）。混合检索因此采用「两路召回各自物化为普通表，再做纯关系融合」。
- 向量 `HNSW` 索引要求**主键为 BIGINT**（故 `products.product_id` 用 BIGINT）；`IVFFLAT` 无此限制。
- `RESTORE` 需指定账户名：`RESTORE ACCOUNT \`<account>\` DATABASE <db> TABLE <tbl> FROM SNAPSHOT <snap>;`
- 云上 `SELECT ... INTO OUTFILE` 不支持；Stage 写文件用 `save_file()`；`datalink` 仅支持 `file://` / `stage://`（不支持 `https`）。
- `SHOW STAGES` 用 `LIKE` 过滤（不支持 `WHERE`）。
- **MatrixOne Cloud Web 控制台**：`SELECT ...; -- 注释`（行尾注释）会被控制台按 `;` 拆出一条"纯注释语句"并显示它的空结果，看起来像"返回空"——**这是控制台显示问题，数据本身正确**（命令行/驱动返回正常）。本仓库脚本已尽量把注释放在语句上方，避免该现象。

## 清理

```bash
mysql -h <host> -P 6001 -u '<account>:admin:accountadmin' -p'<password>' < sql/99_cleanup.sql
```
