"""Independent capability cases, sharing only the database service and containers.

Each instance imports the existing, tested operations with its own state directory.
The SQL boundary maps an explicit list of logical fixture names to a case namespace.
Results are normalized for the reusable operations and expanded for the browser.
No source rewriting, global context switching, or arbitrary operation dispatch.
"""
import importlib.util
import json
from pathlib import Path
import re
import shlex
import time

FEATURES = ('git4data', 'vector', 'fulltext', 'ingest', 'htap', 'recovery', 'pubsub', 'iceberg', 'cdc')
NAMES = ('demo_shop_ci', 'demo_shop', 'demo_ingest', 'demo_pitr_shop', 'demo_story_lake',
         'demo_price_history', 'demo_cdc_pitr', 'demo_load_catalog', 'demo_catalog', 'demo_partner',
         'demo_supplier', 'demo_promo_base', 'demo_before_accident', 'demo_story_ice', 'demo_orders_cdc', 'demo_sink')
CHECKS = {
    'git4data': ['source_count', 'clone_count', 'ci_prices'],
    'vector': ['vector', 'vector_probe', 'vector_plan', 'vector_plan_pre', 'hybrid'],
    'fulltext': ['keyword', 'boolean', 'json_spec', 'document', 'fulltext_tfidf', 'fulltext_bm25', 'fulltext_plan', 'hybrid'],
    'ingest': ['external_rows', 'quality_rows', 'task_runs', 'products', 'order_count'],
    'htap': ['live_report'], 'recovery': ['pitr_policy', 'pitr_prices'],
    'pubsub': ['subscriber'], 'iceberg': ['iceberg_current', 'iceberg_history'], 'cdc': ['cdc_source', 'cdc_sink'],
}
PURPOSES = {
 'source_count': ('源库基线', '正式库仍有 100 万行订单'), 'clone_count': ('Clone 完整性', '候选库也有 100 万行订单'),
 'ci_prices': ('测试隔离', '源价 299，候选价 269.10，分支改动没有写回源库'),
 'vector': ('相似意图召回', '旅行充电向量应优先召回充电器'), 'vector_probe': ('扩大探测范围', '显式 nprobe=2 后仍能返回候选商品'),
 'vector_plan': ('索引执行路径', 'EXPLAIN 包含 ivf_search'), 'vector_plan_pre': ('过滤与索引路径', '指定 pre 模式，检查真实 ivf_search 计划'),
 'hybrid': ('组合筛选', '同时满足 charger 全文、库存和向量排序'),
 'keyword': ('自然语言全文检索', 'charger 命中商品 1'), 'boolean': ('布尔必选词', '+charger 命中商品 1'),
 'json_spec': ('JSON 属性全文', 'GaN 命中商品 1 的 JSON 属性'), 'document': ('文档正文全文', 'warranty 命中 Stage 中 DOCX 的商品 1'),
 'fulltext_tfidf': ('TF-IDF 评分', '返回匹配商品及正相关分数'), 'fulltext_bm25': ('BM25 评分', '同一查询切换算法，观察真实评分'),
 'fulltext_plan': ('全文索引路径', '执行计划包含 fulltext_index_scan'),
 'external_rows': ('原始文件可读', '外表保留全部 7 行，包括坏数据'), 'quality_rows': ('质量规则生效', '记录恰好 1 行异常'),
 'task_runs': ('任务实际执行', 'SUCCESS，影响 6 行商品'), 'products': ('有效商品入库', '业务表只有 6 件有效商品'),
 'order_count': ('独立订单样本', 'generate_series 产生 100 万行，区别于商品导入任务'),
 'live_report': ('提交后立即分析', '订单从 1000 增为 1001，库存从 24 降为 23'),
 'pitr_policy': ('恢复窗口', '查询本案例实际创建的 PITR 策略'), 'pitr_prices': ('恢复内容正确', '六件商品名称与价格逐列等于事故前值'),
 'subscriber': ('独立账号可读', '真正用订阅账号查询六件商品'),
 'iceberg_current': ('当前湖表', '5 行，金额合计 150'), 'iceberg_history': ('历史湖表', '4 行，金额合计仍为 100'),
 'cdc_source': ('源端新订单', '本次新增订单恰好 1 行'), 'cdc_sink': ('目标端已到达', 'MySQL 目标端相同订单恰好 1 行'),
}
# Descriptions explain both intent and the observable acceptance condition.
STEPS = {
 'start': ('连接与版本', '启动或复用本教程数据库，SELECT VERSION() 必须返回 v4.2.4。'),
 'seed': ('创建本案例数据', '创建隔离表并写入确定性样本；核对商品数和订单基线，不依赖其他章节。'),
 'prepare': ('生成 CSV 与 DOCX', '生成 7 行供应商 CSV（含 1 行负价）和文档文件。'),
 'schema': ('定义 Stage 与外表', '给文件路径命名，定义列映射；查到 7 行原始数据和 1 行质量异常。'),
 'ingest': ('定义并执行 SQL Task', '先 CREATE TASK，再 EXECUTE TASK；核对 SUCCESS、6 件商品与 100 万行订单。'),
 'clone': ('Clone 百万行订单', '先建快照再 Clone；两边 COUNT(*) 都必须为 100 万，记录实际耗时。'),
 'ci': ('在分支中测试与修复', '候选库注入负价，使校验失败；修正折扣后校验通过，源库价格必须保持 299。'),
 'search': ('建索引并执行检索', '为商品、JSON 与文档建立全文索引，为向量建立 IVF；每种检索必须返回命中。'),
 'health': ('检查 16 个 IVF 中心', '创建 1200 个确定性向量，读取真实中心分布；不能用示意图代替索引检查。'),
 'rebuild': ('重建为 32 个中心', 'ALTER REINDEX 后重新读取中心数、空中心及负载；数值由本次数据库返回。'),
 'operate': ('事务下单与实时分析', '一次事务扣库存并新增订单；提交后订单数必须增加 1，库存减少 1。'),
 'accident': ('开启 PITR 并制造事故', '先保留正常时间点，再误改六件商品并 DROP TABLE；核对表确实不存在。'),
 'restore_bad': ('先恢复到错误时点', '恢复到误改后、误删前，六件商品仍是零价；证明时间点选错会恢复错误内容。'),
 'snapshot': ('命名快照恢复对照', '创建报表并留快照，误删后按快照恢复两项指标，与 PITR 时间点恢复对照。'),
 'restore': ('恢复事故前数据', '按正常时间点 RESTORE；逐列比对六件商品的名称和价格。'),
 'pubsub': ('发布与独立账号订阅', '创建发布、订阅账号及订阅库；以订阅账号实际查到 6 件商品。'),
 'services': ('准备湖端服务', '启动并探测 MinIO 与 Nessie，验证对象存储和 REST Catalog 可访问。'),
 'lake': ('在湖上定义表', '通过 REST 创建独立 namespace 和四列表定义，读取元数据。'),
 'mapping': ('创建 SQL 外表映射', '注册 Catalog 与访问规则，创建 MatrixOne 外表。此时还没有数据快照。'),
 'write': ('写入首批四行', 'INSERT 产生数据文件和快照，SQL 查到 4 行，金额合计 100。'),
 'history': ('保留历史入口', '创建 Nessie 分支与历史外表，锁定四行时的视图。'),
 'append': ('追加并对照历史', '再写一行：当前 5/150，历史仍为 4/100，核对文件与快照变化。'),
 'cdc': ('建立 CDC 并验证增量', '启动独立 MySQL 目标端、建立任务并等待初始化；新增订单在两端都必须为 1 行。'),
 'verify': ('验收本案例', '执行下列核对 SQL，检查具体业务不变量；全部通过后才标记案例完成。'),
}
PLANS = {
 'git4data': ['start','seed','clone','ci','verify'],
 'vector': ['start','seed','search','health','rebuild','verify'],
 'fulltext': ['start','seed','search','verify'],
 'ingest': ['start','prepare','schema','ingest','verify'],
 'htap': ['start','seed','operate','verify'],
 'recovery': ['start','seed','accident','restore_bad','restore','snapshot','verify'],
 'pubsub': ['start','seed','pubsub','verify'],
 'iceberg': ['start','services','lake','mapping','write','history','append','verify'],
 'cdc': ['start','seed','cdc','verify'],
}
INSTANCES = {}


class Case:
    def __init__(self, core, feature):
        self.core, self.feature = core, feature
        spec = importlib.util.spec_from_file_location('mo_case_' + feature, core.ROOT / 'demo.py')
        self.mo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mo)
        self.mo.RUNTIME = core.RUNTIME / 'cases' / feature
        self.mo.RUNTIME.mkdir(parents=True, exist_ok=True)
        self.mo.STATE_FILE = self.mo.RUNTIME / 'state.json'
        self.mo.FIXTURES = self.mo.RUNTIME / 'fixtures'
        self.progress = self.mo.RUNTIME / 'case.json'
        self.mapping = {name: 'case_' + feature + '_' + name.removeprefix('demo_') for name in NAMES}
        self.trace = []
        self.running_step = None
        command = self.mo.command
        lake_http = self.mo.lake_http

        def redact(value):
            value = re.sub(r'(mysql://[^:]+:)[^@]+@', r'\1<password>@', str(value))
            return re.sub(r'(?i)(PASSWORD=)[^\s]+', r'\1<password>', value)
        self.redact = redact

        def traced(source, statement, user, operation):
            started = time.monotonic()
            entry = {'sql': redact(statement), 'source': source, 'user': user,
                     'started_at': time.time(), 'status': 'running'}
            self.trace.append(entry)
            try:
                result = operation()
                if source == 'rest':
                    if isinstance(result, bytes):
                        response = f'对象存储返回 {len(result)} 字节'
                    else:
                        safe = {key: value for key, value in result.items()
                                if key in ('namespace', 'name', 'hash', 'metadata-location', 'location', 'current-snapshot-id')}
                        response = json.dumps(safe, ensure_ascii=False) if safe else 'REST 请求成功；返回字段：' + ', '.join(result.keys())
                else:
                    response = result or '执行成功（无结果集）'
                    if source == 'shell' and len(response) > 4000:
                        response = response[-4000:] + '\n（仅展示命令输出末尾 4000 字符）'
                entry.update(ok=True, status='success', result=redact(response))
                return result
            except Exception as exc:
                entry.update(ok=False, status='error', result=redact(exc))
                raise
            finally:
                entry['duration_ms'] = round((time.monotonic() - started) * 1000)

        def scoped_command(args, **kwargs):
            if args[0] != 'mysql':
                return traced('shell', shlex.join(args), '', lambda: command(args, **kwargs))
            actual = [self.names(arg) for arg in args]
            sql = actual[actual.index('-e') + 1]
            def execute():
                result = command(actual, **kwargs)
                if sql.strip().upper().rstrip(';') in ('SHOW CDC ALL', 'SHOW PITR', 'SHOW STAGES', 'SHOW DATABASES'):
                    result = '\n'.join(line for line in result.splitlines() if any(name in line.split('\t') for name in self.mapping.values()))
                return self.names(result, reverse=True)
            source = 'mysql' if '13307' in actual else 'matrixone'
            return traced(source, sql, actual[actual.index('-u')+1], execute)
        self.mo.command = scoped_command

        def scoped_lake_http(path, body=None, **kwargs):
            method = 'POST' if body is not None else 'GET'
            statement = method + ' ' + ('http://127.0.0.1:9000' if kwargs.get('storage') else 'http://127.0.0.1:19120') + path
            if body is not None:
                statement += '\n' + json.dumps(body, ensure_ascii=False)
            return traced('rest', statement, '', lambda: lake_http(path, body, **kwargs))
        self.mo.lake_http = scoped_lake_http

    def names(self, value, reverse=False):
        mapping = {v:k for k,v in self.mapping.items()} if reverse else self.mapping
        return re.sub(r'\b(' + '|'.join(map(re.escape, sorted(mapping, key=len, reverse=True))) + r')\b', lambda m:mapping[m[0]], value)

    def public(self, value):
        if isinstance(value, str): return self.names(value)
        if isinstance(value, list): return [self.public(x) for x in value]
        if isinstance(value, dict): return {k:self.public(v) for k,v in value.items()}
        return value

    def read(self):
        return json.loads(self.progress.read_text()) if self.progress.exists() else {'completed': [], 'records': {}, 'verified': False}

    def write(self, value):
        tmp = self.progress.with_suffix('.tmp')
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
        tmp.replace(self.progress)

    def view(self):
        state = self.mo.load_state()
        state['case'] = {**self.read(), 'feature': self.feature, 'namespace': 'case_' + self.feature + '_',
                         'running_step': self.running_step, 'live_trace': [dict(t) for t in self.trace] if self.running_step else [],
                         'steps': [dict(id=s, title=STEPS[s][0], why=STEPS[s][1], sql=self.preview(s)) for s in PLANS[self.feature]]}
        return self.public(state)

    def preview(self, step):
        if step == 'seed': return ';\n'.join(self.seed_sql()[2])+';'
        if step == 'verify':
            try: return '\n'.join(self.mo.run_check(c, preview=True)['sql'] for c in CHECKS[self.feature])
            except self.mo.DemoError: return '-- 前置步骤完成后显示带实际参数的验收 SQL。'
        if step in ('restore', 'restore_bad'):
            data = self.mo.load_state().get('pitr')
            if data:
                timestamp = data['good_at' if step=='restore' else 'bad_at']
                return f"RESTORE DATABASE demo_pitr_shop FROM PITR demo_price_history '{timestamp}';\nSELECT product_id,name,price FROM demo_pitr_shop.prices ORDER BY product_id;"
        return ''

    def seed_sql(self):
        m = self.mo
        db = 'demo_shop_ci' if self.feature in ('vector', 'fulltext') else 'demo_shop'
        schema = (m.ROOT / 'sql/01_schema.sql').read_text().split('USE demo_shop;')[1]
        def literal(v): return "'" + str(v).replace("'", "''") + "'"
        values = ['(' + ','.join(literal(v) for v in (*row, m.VECTORS[row[0]])) + ')' for row in m.PRODUCTS[:6]]
        statements = [f'CREATE DATABASE IF NOT EXISTS {db}; USE {db};' + schema.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
                      f'TRUNCATE TABLE {db}.products; TRUNCATE TABLE {db}.orders; TRUNCATE TABLE {db}.product_docs;',
                      f'INSERT INTO {db}.products VALUES ' + ','.join(values)]
        rows = 1000000 if self.feature == 'git4data' else 1000
        if self.feature not in ('vector', 'fulltext'):
            statements.append(f"INSERT INTO {db}.orders SELECT result,1+(result%6),1,99.00,'2026-09-01 10:00:00' FROM generate_series(1,{rows}) g")
        else:
            statements.extend([f"CREATE STAGE IF NOT EXISTS demo_supplier URL='file://{m.FIXTURES}/'",
                               f"INSERT INTO {db}.product_docs VALUES(1,1,'stage://demo_supplier/travel_charger.docx')"])
        return db, rows, statements

    def seed(self):
        m = self.mo
        db, rows, statements = self.seed_sql()
        if self.feature in ('vector','fulltext'): m.step_prepare()
        for sql in statements: m.mysql(sql, timeout=600)
        orders = 0 if self.feature in ('vector','fulltext') else rows
        if int(m.scalar(f'SELECT COUNT(*) FROM {db}.products')) != 6 or int(m.scalar(f'SELECT COUNT(*) FROM {db}.orders')) != orders:
            raise m.DemoError('本案例样本数量不匹配')
        m.event('ingest', '本案例样本已准备', '6 件商品；订单按本案例规模准备', metrics={'products':6, 'orders':orders})

    def require(self, condition, message):
        if not condition: raise self.mo.DemoError(message)

    def verify(self):
        m = self.mo
        self.validation_checks = []
        if self.feature == 'iceberg': m.step_iceberg()
        if self.feature == 'recovery':
            data = m.pitr_lab('inspect')
            self.validation_checks.append({'check':'recovery_phase', 'title':'恢复时间点',
                'purpose':'当前数据库必须处于事故前的正常状态', 'sql':'-- PITR 恢复状态',
                'columns':['实际状态'], 'rows':[[data['phase']]], 'passed':data['phase']=='good'})
        results = []
        for check in CHECKS[self.feature]:
            try:
                result = m.run_check(check)
            except m.DemoError as exc:
                try: sql = m.run_check(check, preview=True)['sql']
                except m.DemoError: sql = ''
                result = {'check':check, 'sql':sql, 'columns':[], 'rows':[], 'error':str(exc)}
            result['title'], result['purpose'] = PURPOSES[check]
            result['passed'] = bool(result['rows']) and not result.get('error')
            results.append(result)
            self.validation_checks.append(result)
        by_check = {result['check']: result for result in results}
        def mark(check, passed):
            by_check[check]['passed'] = bool(passed) and by_check[check]['passed']
        def rows(check): return by_check[check]['rows']
        if self.feature == 'git4data':
            mark('source_count', rows('source_count') == [['1000000']])
            mark('clone_count', rows('clone_count') == [['1000000']])
            mark('ci_prices', len(rows('ci_prices')) == 2 and dict(rows('ci_prices')) == {'source':'299.00','candidate':'269.10'})
        if self.feature == 'htap':
            mark('live_report', bool(rows('live_report')) and rows('live_report')[0][0] == '1001')
            try:
                stock = m.scalar('SELECT stock FROM demo_shop.products WHERE product_id=1')
                self.validation_checks.append({'check':'stock', 'title':'库存扣减', 'purpose':'商品 1 库存从 24 降为 23',
                    'sql':'SELECT stock FROM demo_shop.products WHERE product_id=1;', 'columns':['stock'],
                    'rows':[[stock]], 'passed':stock=='23'})
            except m.DemoError as exc:
                self.validation_checks.append({'check':'stock', 'title':'库存扣减', 'purpose':'商品 1 库存从 24 降为 23',
                    'sql':'SELECT stock FROM demo_shop.products WHERE product_id=1;', 'columns':[], 'rows':[],
                    'error':str(exc), 'passed':False})
        if self.feature == 'vector':
            mark('vector', bool(rows('vector')) and rows('vector')[0][0]=='1')
            mark('vector_plan', 'ivf_search' in str(rows('vector_plan')))
            mark('vector_plan_pre', 'ivf_search' in str(rows('vector_plan_pre')))
            try:
                health = m.vector_health('check')
                self.validation_checks.append({'check':'ivf_health', 'title':'IVF 重建',
                    'purpose':'1200 个向量，32 个真实中心', 'sql':health['sql'],
                    'columns':['向量数','中心数'], 'rows':[[health['vectors'],health['centroids']]],
                    'passed':health['vectors']==1200 and health['centroids']==32})
            except m.DemoError as exc:
                self.validation_checks.append({'check':'ivf_health', 'title':'IVF 重建',
                    'purpose':'1200 个向量，32 个真实中心', 'sql':'-- 查询 IVF 中心分布',
                    'columns':[], 'rows':[], 'error':str(exc), 'passed':False})
        if self.feature == 'cdc':
            for check in CHECKS[self.feature]: mark(check, rows(check) == [['1']])
        if self.feature == 'pubsub': mark('subscriber', len(rows('subscriber')) == 6)
        if self.feature == 'ingest':
            mark('external_rows', rows('external_rows') == [['7']])
            mark('quality_rows', len(rows('quality_rows')) == 1)
            mark('task_runs', bool(rows('task_runs')) and rows('task_runs')[0][2:] == ['SUCCESS','6'])
            mark('products', len(rows('products')) == 6)
            mark('order_count', rows('order_count') == [['1000000']])
        if self.feature == 'fulltext':
            for check in CHECKS[self.feature][:6]:
                mark(check, bool(rows(check)) and rows(check)[0][0]=='1')
            mark('fulltext_plan', 'fulltext_index_scan' in str(rows('fulltext_plan')))
        if self.feature == 'iceberg':
            mark('iceberg_current', rows('iceberg_current') == [['5','150']])
            mark('iceberg_history', rows('iceberg_history') == [['4','100']])
        failed = [result['title'] for result in self.validation_checks if not result['passed']]
        if failed:
            raise m.DemoError('验收未通过：' + '、'.join(failed))
        return {'checks': self.validation_checks, 'message': '本案例验收通过'}

    def run(self, step):
        progress = self.read()
        expected = next((s for s in PLANS[self.feature] if s not in progress['completed']), None)
        if step != expected: raise self.core.DemoError(f'请先完成本案例步骤：{expected or "已完成，可重置重跑"}')
        self.trace = []
        self.running_step = step
        self.validation_checks = []
        try:
            result = None
            if step == 'start':
                self.core.step_start(record=False)
                version = self.mo.scalar('SELECT VERSION()')
                self.mo.event('start', '本案例连接就绪', version)
            elif step == 'seed': self.seed()
            elif step in ('health','rebuild'): result = self.mo.vector_health('check' if step=='health' else 'rebuild')
            elif step == 'accident': result = self.mo.pitr_lab('prepare')
            elif step == 'restore_bad': result = self.mo.pitr_lab('restore_bad')
            elif step == 'snapshot': result = self.mo.pitr_lab('snapshot')
            elif step == 'restore':
                result = self.mo.pitr_lab('restore_good')
                self.mo.event('recover', '恢复已逐列核对', '六件商品与正常时间点一致')
            elif step in self.mo.ICEBERG_PHASES: result = self.mo.iceberg_lab(step)
            elif step == 'verify': result = self.verify()
            else: result = self.mo.run_step(step, 1000000)
            progress['completed'].append(step)
            progress['verified'] = step == 'verify'
            progress['records'][step] = {'ok':True, 'trace':self.trace, 'result': self.public(result)}
        except Exception as exc:
            message = self.redact(exc)
            progress['records'][step] = {'ok':False, 'trace':self.trace, 'error':message}
            if step == 'verify':
                progress['records'][step]['result'] = {'checks':self.validation_checks, 'message':message}
            self.write(progress)
            raise self.core.DemoError(message) from exc
        finally:
            self.running_step = None
        self.write(progress)
        return self.view()

    def reset(self):
        # Shared service ownership is checked by the main start operation.
        self.core.step_start(record=False)
        m = self.mo
        self.trace = []
        if any('demo_orders_cdc' in row for row in m.mysql('SHOW CDC ALL')):
            m.mysql('DROP CDC TASK demo_orders_cdc')
        m.sql_file('99_reset.sql')
        if self.feature == 'cdc':
            names = m.command(['docker','ps','-a','--format','{{.Names}}']).splitlines()
            if 'matrixone-demo-mysql-42' in names:
                m.command(['docker','start','matrixone-demo-mysql-42'])
                deadline = time.monotonic()+90
                while True:
                    try:
                        m.sink_mysql('DROP DATABASE IF EXISTS demo_sink')
                        break
                    except m.DemoError:
                        if time.monotonic()>deadline: raise
                        time.sleep(2)
        remaining = m.mysql('SHOW DATABASES')
        self.require(not any(row[0] in NAMES[:5] for row in remaining), '本案例数据库清理失败')
        archive = m.RUNTIME / 'history'
        archive.mkdir(exist_ok=True)
        (archive / f'{time.time_ns()}.json').write_text(json.dumps({'case':self.read(),'state':m.load_state()},ensure_ascii=False))
        m.save_state(m.initial_state())
        for name in ('products.csv','travel_charger.docx'): (m.FIXTURES/name).unlink(missing_ok=True)
        self.write({'completed': [], 'records': {}, 'verified':False, 'reset':{'verified':True, 'trace':self.trace,
                    'note':'本案例 SQL 数据和进度已清理；连接配置、运行容器及湖端历史保留，下一轮湖表使用新 namespace。'}})
        return self.view()


def get(core, feature):
    if feature not in FEATURES: raise core.DemoError('未知能力案例')
    if feature not in INSTANCES: INSTANCES[feature] = Case(core, feature)
    return INSTANCES[feature]


def dispatch(core, body):
    case = get(core, str(body.get('case', '')))
    action = body.get('action')
    case.trace = []
    try:
        if action == 'run': return case.run(str(body.get('step', '')))
        if action == 'reset':
            if body.get('confirm') != 'reset-case': raise core.DemoError('请确认重置本案例')
            return case.reset()
        if action == 'check': result = case.mo.run_check(str(body.get('check', '')))
        elif action == 'query': result = case.mo.demo_query(case.names(str(body.get('sql','')), reverse=True))
        elif action == 'insight': result = case.mo.inspect_feature(case.feature, body)
        elif action == 'vector-health': result = case.mo.vector_health(str(body.get('operation','check')))
        elif action in ('pitr', 'iceberg'):
            if body.get('operation', 'inspect') != 'inspect':
                raise core.DemoError('写入和恢复请在本案例步骤中执行，以保持验收顺序')
            result = case.mo.pitr_lab('inspect') if action == 'pitr' else case.mo.iceberg_lab('inspect')
        else: raise core.DemoError('未知案例操作')
        return case.public(result)
    except Exception as exc:
        raise core.DemoError(str(exc)) from exc
