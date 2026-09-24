# MatrixOne 能力实验文档

这是一个基于 MatrixOne **v4.2.4** 的本地多页功能文档。九项功能各自按“功能介绍 → 细节补充 → SQL 解释 → 场景执行与解释”展开。每个功能页都有从零准备、逐步执行、验收与单独重置的完整案例；一家电商准备大促的场景提供完整的 13 步操作路径。

## 新用户旅程

1. **准备环境**：首次运行 `./demo/setup.sh`，安装依赖、准备源码；用 `./demo/start.sh --check` 查看缺项。
2. **启动**：运行 `./demo/start.sh`，打开终端给出的地址。数据库启动后已执行版本核对，首次构建日志有明确路径。
3. **先认识能力**：首页 `/` 浏览九项能力；进入功能文档阅读“是什么、有什么用、机制图、关键 SQL”。没有本机数据时，示例证据会明确标注。
4. **就在功能页实操**：点击“从零实操”，按本案例步骤准备数据、执行操作并验收。每一步显示用途、SQL、真实返回与通过条件；无需先跑其他章节。
5. **深入观察，或串联场景**：功能页图表自动读取本案例数据；IVF 检查与重建、PITR 时间点对照、Iceberg 建表读写都是案例步骤。另可进入 `/demo.html?step=start` 阅读独立的 13 章贯穿场景。
6. **自由查询与回看**：SQL 控制台可编辑只读查询；执行记录页保留 SQL、时间和结果。功能文档是主线，场景负责把它们串起来。
7. **下一轮演示**：功能页“重置本案例”只清理当前能力的数据与进度。主线场景的“从头演示”或 `./demo/start.sh --reset` 清理主线；二者互不代替。

### 九个独立案例

| 能力页 | 从零开始的完整操作 |
| --- | --- |
| Git for Data | 六件商品与百万行订单 → 快照 / Clone → 注入错误、CI 失败与修复 → 源库隔离验收 |
| 向量 | 六条商品向量与混合检索材料 → IVF / Top-K / nprobe / EXPLAIN → 1200 向量的 16 中心检查 → 重建 32 中心 → 验收 |
| 全文 | 商品、JSON 属性与 DOCX → 索引 → 自然语言 / 布尔 / JSON / 文档 / TF-IDF / BM25 / 混合查询 → 验收 |
| Stage / 外表 / Task | 生成材料 → Stage 和外表 → 识别坏数据 → 定义并执行 Task → 验收 7 / 1 / 6 行和独立订单基线 |
| HTAP | 六件商品与 1000 单 → 事务下单 → 订单 1001、库存 23、实时汇总验收 |
| PITR / 恢复 | 准备样本 → 建策略、记录时间点、误改和误删 → 错误时间点对照 → 正常时间点恢复 → 快照恢复对照 → 逐列验收 |
| Publish / Subscribe | 准备商品 → 发布 → 新账号订阅 → 真正用订阅账号验收六行 |
| Iceberg | 服务 → REST 建空湖表 → SQL 映射 → 写四行 → 保留历史引用 → 追加第五行 → 当前 5/150、历史 4/100 验收 |
| CDC | 六件商品与 1000 单 → MySQL 目标端 → CDC 任务及初始化 → 新增订单 → 两端核对 |

每个案例使用固定的 `case_<能力名>_` SQL 命名空间，例如 `case_vector_shop_ci`；数据、账号、任务、快照和 PITR 名称均隔离。状态与实际 SQL 回执放在 `demo/runtime/cases/<能力名>/`。共享数据库服务、MinIO/Nessie 与 MySQL 容器，但 CDC 目标库和湖表命名空间独立。

“重置本案例”会清除该案例的 SQL 对象、CSV/DOCX 和进度，并核对数据库已不存在；其他案例及 `demo_*` 主线数据保留。连接配置与湖端历史文件保留，下一轮使用新湖表命名空间。步骤失败不会标记成功，保留错误及已执行 SQL；可修复重试或重置重跑。

功能页的验收查询已经归入最后的验收步骤，每条都说明验证什么，显示实际 SQL、行数与表格。执行时只更新当前步骤的状态与结果，保留滚动位置和 SQL 区，不重建整页或跳回案例顶部。需要更新上方图表与指标时，主动点击“查看本次机制图与指标”。图表是机制解释和数据观察，写入与恢复统一通过案例步骤执行。

可重复的集成验证（会重置九个 `case_*` 案例，保留主线）：

```bash
python3 demo/tests/cases_smoke.py --run
```

场景的操作顺序：

| 阶段 | 操作与核对 |
| --- | --- |
| 1–4 · 数据进入 | 版本 → CSV / DOCX → Stage / 外表读取 7 行、记录 1 行异常 → SQL Task 导入 6 件商品，另建 100 万行订单 |
| 5–8 · 开发验证 | 百万行 Clone → 候选库注入错误并修复、核对源库隔离 → 全文 / 向量 / 文档检索 → 验证后上线 |
| 9–10 · 业务与恢复 | 下单、扣库存、立即分析 → 提前设置 PITR、误改和误删、恢复并核对六件商品 |
| 11–13 · 数据流转 | 跨账号订阅 → Iceberg 建表、写入、当前与历史快照对照 → CDC 订单在两端核对 |

## 安装环境 → 启动 → 重复演示

在仓库根目录运行，使用普通用户即可（安装系统包时会调用 sudo）：

```bash
./demo/setup.sh          # 首次：安装依赖、准备固定 release 源码和 Go 工具链
./demo/start.sh          # 每次：预检 → 构建/复用数据库 → 启动网页服务
```

打开 <http://127.0.0.1:8042/>，选择任意功能页，点击“从零实操”。数据库启动后会真实执行 `SELECT VERSION()`；各能力案例独立准备数据。贯穿主线可从导航“场景演示”进入。**不要双击 HTML 文件**。网页仅监听本机，无需 Node.js、npm 或 Python 第三方包。

### 环境准备具体做什么

自动安装支持 **Debian 12/13、Ubuntu 22.04/24.04，Linux amd64 / arm64**。需要联网、sudo 软件安装权限；建议 16 GiB 内存、30 GiB 可用磁盘。首次源码编译、Go 模块和镜像下载可能需要较长时间，实际取决于机器与网络。编译日志在 `demo/runtime/build.log`，可用 `tail -f demo/runtime/build.log` 查看；失败后修复再运行启动器。

| 项目 | 安装 / 使用方式 |
| --- | --- |
| Python ≥ 3.10、Git、curl、证书 | 系统 apt 软件包；Python 仅使用标准库 |
| SQL 客户端 | MariaDB 客户端，提供演示需要的 `mysql --skip-ssl` |
| C/C++ 构建依赖 | build-essential、CMake、pkg-config、unzip、libomp-dev |
| Docker / Compose | 复用已有引擎；缺失时配置 Docker 官方 apt 源安装。不会自动移除已有 containerd；冲突时给出提示 |
| MatrixOne 源码 | 优先复用 `~/matrixone`，缺失时克隆 v4.2.4；另建 detached release worktree，保持原仓库分支 |
| Go | 从 release 的 `go.mod` 读取版本（当前 1.26.4）；可用工具链直接复用，否则下载官方归档并核对 SHA256，安装到 `demo/runtime/tools/` |

Docker 服务由 systemd 启动；脚本会为需要权限的当前用户加入 docker 组，该组具备管理员级容器权限。`start.sh` 能在新组权限下启动，不需要退出登录。已有 Docker Desktop、远程 Docker context 或非 systemd 环境，请先自行确保 `docker info` 成功。其他操作系统请在上述 Linux 环境运行，当前脚本不承诺自动安装。

系统依赖参考 [Docker Debian 安装](https://docs.docker.com/engine/install/debian/)、[Compose 插件](https://docs.docker.com/compose/install/linux/) 和 [Go 安装](https://go.dev/doc/install)；源码编译依赖按本地 v4.2.4 的 Makefile 与开发镜像核对。

```bash
./demo/start.sh --check  # 只检查，不安装、不启动、不改数据
./demo/setup.sh --check # 同样只检查；新 docker 组权限请使用上面的 start.sh
```

网页第一章也有“检查本机环境”，逐项展示检查结果。依赖安装失败后可修复网络/权限再重跑；已下载的源码、工具链和已编译二进制会复用。配置写入被 Git 忽略的 `demo/runtime/env.sh`。

默认数据库端口 `16042`、网页端口 `8042`；Iceberg 使用 `9000/9001/19120/19121`，CDC MySQL 使用 `13307`。这些外部组件在对应章节才启动。启动器识别同一目录的已有网页服务并复用；端口被其他网页服务占用时会报错。旧版 `python3 demo/demo.py serve` 服务需先关闭，再用新启动器启动。

路径覆盖示例（设置后再执行安装/启动）：

```bash
export MO_DEMO_SOURCE_DIR=/path/to/matrixone
export MO_DEMO_RELEASE_DIR=/path/to/matrixone-v4.2.4-demo
# 可选：export MO_DEMO_PORT=16042 MO_DEMO_WEB_PORT=8042
./demo/setup.sh
./demo/start.sh
```

源码编译目录不能含空白字符。启动器显示实际网页地址；文档中的端口示例使用默认值。

### 重置：从空的演示数据重新开始

网页场景页底部点击 **“从头演示”**，确认清理范围；也可执行：

```bash
./demo/start.sh --reset
```

这是数据重置，不仅是进度归零：先停止演示 CDC 任务，再删除五个演示库 `demo_shop`、`demo_shop_ci`、`demo_ingest`、`demo_pitr_shop`、`demo_story_lake`，以及演示 SQL Task、Stage、快照、PITR、发布、订阅账号，清空 CDC MySQL 的 `demo_sink`。核对演示库不存在后才清空网页进度，回到第一章。SQL 清单见 [`sql/99_reset.sql`](sql/99_reset.sql)。重置仅连接由本教程启动并核对进程身份的 MatrixOne。

依赖、编译产物、容器和数据库服务保留；Iceberg catalog 与访问映射作为连接配置复用（v4.2.4 不允许直接删除仍被访问策略引用的 catalog）。Iceberg 湖端历史与文件保留，新一轮自动使用新命名空间，因此不会读到上一轮数据。重置前的进度与湖端命名空间保存在 `demo/runtime/reset-history/`。这不是删除所有容器和磁盘文件的卸载操作。中途失败会保留进度和错误，修复后可重试。正在运行章节时，网页拒绝并发重置。

`Ctrl+C` 关闭当前前台网页服务，数据库继续运行。停止本教程数据库：`python3 demo/demo.py stop`；再次 `./demo/start.sh` 可继续。若只阅读文档而暂不启动数据库，仍可用 `python3 demo/demo.py serve`。

更新教程代码后，如果旧网页进程仍占用端口，`start.sh` 会提示先在原终端按 `Ctrl+C` 关闭它，再重新启动；不会让新版页面继续连接旧版处理器。网页 API 只接受本机地址和 JSON 写入请求。

## 如何阅读

| 页面 | 内容 |
| --- | --- |
| 能力目录 `/` | Git for Data、向量、全文三项重点能力；Stage/外表/ETL、HTAP、误删恢复、Publish/Subscribe、Iceberg、CDC 六项配套能力。 |
| 功能详解 `/capability.html?id=git4data` | 每项功能依次介绍用途、关键对象、本机数据证据、SQL 与操作。九个数据探查器可读取真实表、索引和目标端结果：Git 的大表行数与 CI 状态、IVF 中心与 nprobe、全文倒排项与评分等都可以切换查看。正文逐层解释图、查询和使用边界。 |
| 场景演示 `/demo.html` | 13 章连续的操作记录，从启动到 CDC 按顺序完成整条业务路径；每步可看 SQL 和执行结果。 |
| SQL 控制台 `/lab.html?tab=sql` | 可编辑单条只读 SELECT/SHOW，查看连接、结果表格、返回行数与耗时。另有搜索和下单操作。 |
| SQL 与结果 `/evidence.html` | 本机运行留下的 SQL、返回值、事件时间线和能力指标。 |

首次启动页介绍 Docker、mo_ctl 和本地源码构建等方式；文档实际演示的是隔离的 **v4.2.4 本地一键启动**。功能页中含占位符的 SQL 用于讲解，控制台核对查询通过 `/api/check` 真正运行；普通 MatrixOne 查询也能编辑后通过 `/api/query` 执行。订阅账号与 MySQL 目标端查询保持指定连接。章操作通过 `/api/step` 执行 DDL、写入、Task 等完整流程。只读查询最多展示 100 行。准备 CSV/DOCX 和启动外部容器等步骤包含非 SQL 操作，页面会单独说明。

数据入口章节按以下对象关系解释 SQL：

```text
products.csv (7 行，含 1 行负价)
  └─ demo_supplier Stage：给文件目录命名
       └─ supplier_feed 外表：定义 CSV 列与格式，SELECT 仍读原始文件
            ├─ quality_issues：独立 INSERT 记录异常 1 行
            └─ CREATE TASK demo_load_catalog：保存有效商品的 INSERT ... SELECT
                 └─ EXECUTE TASK：手动运行，SHOW TASK RUNS 核对 SUCCESS 与影响行数
                      └─ demo_shop.products：6 行

Task 之外：为六件商品补预置向量；让 product_docs 指向 Stage 中的 DOCX
Task 之外：generate_series 另建 100 万行订单
```

`demo_load_catalog` 是 [`sql/02_task.sql`](sql/02_task.sql) 中定义的任务名，不是预置命令。Stage、外表、质量表和 Task 的实际执行脚本分别在 [`sql/01_schema.sql`](sql/01_schema.sql) 与 `sql/02_task.sql`；场景页展示定义、触发和核对所需的 SQL。

内容深度参考 MatrixOne 官方 Tutorial 中的 [大表 Clone](https://docs.matrixorigin.cn/mo/en/latest/MatrixOne/Tutorial/efficient-clone-demo.html)、[IVF 索引健康度](https://docs.matrixorigin.cn/mo/en/latest/MatrixOne/Tutorial/ivf-index-health-demo.html)、[混合检索](https://docs.matrixorigin.cn/mo/en/latest/MatrixOne/Tutorial/hybrid-search-demo.html) 等专题，以及对应 v4.2.4 release 的 BVT：Git for Data 展示百万行 Clone 和 CI 隔离；向量覆盖写入、IVF、Top-K、索引健康与重建，并解释 HNSW、混合检索和应用接口；全文覆盖自然语言、布尔、JSON 与 DATALINK 文档。其他功能页面也展示从准备、执行到验证的完整链条。官方教程中 SDK 和其他业务应用的扩展主题通过各功能页链接，不把未在本演示运行的内容写成实测结果。

功能页的数据探查器在对应步骤完成后，通过 `/api/insight` 读取本机真实表、索引内部表或 MySQL 目标端。在运行前，同一图显示一次 v4.2.4 完整场景留下的可交互示例证据，并用紫色提示明确标出；示例文件是 `web/sample-insights.json`。Git 共享区块和增量符号是机制示意，旁边的行数、价格和 Clone 耗时来自对应运行记录；二维 IVF 点位由真实四维向量投影，中心归属和 Top-K 由索引及 SQL 查询给出。切换全文词项、评分算法、外表质量门槛或向量查询，在本机模式下会重新执行只读 SQL；切换 Git 阶段、恢复事件和数据引用只改变已读取证据的呈现。场景写入、SQL 控制台和 IVF 健康实验连接本机服务；向量和全文的 `EXPLAIN` 在本地执行，并依据原始计划标出 `ivf_search` / `fulltext_index_scan`。Git Clone 的物理存储字节数未在本演示测量，不把逻辑表大小当作共享存储证据。

## 演示内容

1. 启动 v4.2.4，执行 `SELECT VERSION()`。
2. 生成带一条坏数据的供应商 CSV 与 DOCX；Stage、外表读取 7 行，质量规则记录 1 行异常。
3. 定义并手动执行 `demo_load_catalog` SQL Task，导入 6 件有效商品；脚本随后单独写入预置向量、DOCX 引用，并用 `generate_series` 生成 100 万行订单。
4. 快照与 Clone 出独立候选库；Clone 时源库、候选库各查询 100 万行，并记录本次耗时。后续下单会增加源库行数，重新查询时会看到当前值；候选库仍保留原基线。候选库中注入负价，CI 校验失败后修复，证明源库未受影响。
5. 建全文与 IVFFLAT 向量索引，查询商品关键词、意图向量与 Stage 中 DATALINK 文档。向量为预生成 4 维数据，不调用外部嵌入模型。
6. 将通过验证的价格和索引应用到正式库；提交订单、扣库存，立即查询汇总指标。
7. 提前为独立价格库开启 PITR，误改并真实 `DROP TABLE` 后确认查询失败，按事故前时间恢复六件商品并逐列核对；快照恢复作为可选对照。
8. 通过 Publish/Subscribe 让另一个账号查询商品；查询 Iceberg 当前/历史快照；创建 CDC 任务并在 MatrixOne/MySQL 两端核对同一新订单。

“从头演示”会执行上述真实数据重置；再次运行 Stage/外表步骤会重建演示专用的 `demo_*` 数据库、快照、任务、账号和发布。运行材料和状态写入被 Git 忽略的 `demo/runtime/`。

本地服务、数据库与目标端的关系：

```text
浏览器 HTML → 127.0.0.1:8042 (Python 标准库服务)
                    ├─ SQL → MatrixOne v4.2.4 :16042
                    ├─ 订阅核对 → demo_partner 账号
                    └─ CDC 核对 → 独立 MySQL :13307
```

只看当前进度可运行 `python3 demo/demo.py status`。如需停止本演示启动的 MatrixOne 服务，运行 `python3 demo/demo.py stop`。

页面无需前端构建工具。视觉参考本地 `memoria-website/frontend/public/landing.html` 的深色画布，采用留白更充分的文档版式与青绿、紫色数据标记。中文字体是精简的 Noto Sans CJK SC，许可见 `web/LICENSE-NotoSansCJK.txt`。


PITR 时间点演练位于“PITR · 误删恢复”功能页与第 10 章。策略 `demo_price_history` 为独立数据库 `demo_pitr_shop` 保留一小时历史：复制六件商品 → 记录正常价格时间 → 全表误改为零价 → 记录零价时间 → DROP 表。页面可以选择两个实际时间点，再执行 `RESTORE DATABASE ... FROM PITR`，并把返回行与该时间点的记录逐列比较。第 10 章以 PITR 误删表恢复为主线；命名快照恢复是页面中的可选对照；已有演示进度可直接使用页面的 PITR 实验。

PITR 恢复时间必须在策略生效且尚未过期的窗口内。本机 v4.2.4 按服务器本地时区解析秒级恢复字符串，脚本用 `SELECT NOW()` 取时间并等待跨过秒边界。`RESTORE DATABASE` 会回退指定数据库在所选时刻之后的修改；实验只恢复独立价格库。PITR 结果与查询记录写入本机状态和 SQL 证据。CDC 使用的 `demo_cdc_pitr` 是另一项策略，承担变更保留前置条件，不能替代这里的时间点恢复介绍。


Iceberg 功能页与第 12 章从零解释四个角色：MatrixOne 执行 SQL，Nessie 提供 REST Catalog，Iceberg 元数据组织表和快照，MinIO 保存实际文件。页面提供六个可单独执行的阶段：启动服务 → REST 创建 namespace 与空湖表 → 注册 Catalog、配置访问并创建外表映射 → INSERT 四行 → 保存 Nessie 历史分支并建第二个映射 → 追加第五行与历史对照。每步显示自己的 Shell、REST 请求或 SQL，以及实际返回记录；不再把准备过程隐藏在 E2E 程序后面。

`demo_story_lake` 是 MatrixOne 数据库，`demo_story_ice` 是它注册的 Catalog 名称；`demo_lake_…` 是湖上的 namespace。两个本地外表 `append_orders` / `append_orders_old` 指向同一湖表、不同 Nessie ref。页面同时显示 Catalog 分支名和 Iceberg 表 snapshot ID，避免混淆。当前数据与历史数据分别为 5 行 / 150 和 4 行 / 100；元数据位置与存储文件清单来自本机 REST 和 MinIO 列举。目录可能含历史对象，不能据此推断查询实际扫描了所有文件。

本机 v4.2.4 的新空湖表尚无数据快照时，SELECT 会报告 `ICEBERG_TABLE_NOT_FOUND: snapshot ref was not found`。映射步骤保留该实际错误，首次 INSERT 后才运行数据查询。本例启用 `enable` 和 `enable-write`，并调用 `iceberg_register_access` 注册本地访问范围；使用未分区 v2 表与 append_only 读写，`bucket` 是普通列。重新演示会创建新 namespace，在映射步骤重建演示专用数据库，旧湖上对象继续保留。

## 本次入口验证范围

在 Debian 13 现有开发机上实测：环境预检、源码/工具链准备的复用路径、重复启动复用网页服务、真实数据重置，及重置后全部 13 章重新运行（100 万行导入与 Clone、PITR、Iceberg、CDC）。浏览器检查覆盖环境面板、取消/确认重置和 390px 手机宽度。Debian 13、Ubuntu 24.04 干净容器已验证系统依赖可解析。

尚未完成全新虚拟机的从零安装验证，也未实测 Debian 12、Ubuntu 22.04 与 arm64 的完整安装/编译；这些平台按包名和官方安装方式支持，不能把现有机器的结果视为全平台验证。

独立案例的入口是 `GET /api/case?feature=...` 与 `POST /api/case`；前端按能力页自动选择案例命名空间。既有 `/api/step` 与主线 SQL 控制台仍使用 `demo_*`。本次九个案例均通过真实重置、重复重置、从零执行与验收；重置隔离检查对比其他案例及主线的商品逐列数据与订单汇总。向量案例另经浏览器逐步执行和重置验证，390px 无横向溢出。
