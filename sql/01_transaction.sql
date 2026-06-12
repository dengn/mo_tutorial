-- =====================================================================
-- 能力一：事务能力 (ACID)
-- 场景：电商下单 = 扣余额 + 扣库存 + 写订单 + 写明细，必须「同生共死」
-- 建议执行： mysql ... mo_demo --force < 01_transaction.sql
-- =====================================================================
USE mo_demo;

-- 幂等复位：撤销本脚本上一次运行留下的痕迹，便于反复演示
DELETE FROM order_items WHERE order_id IN (1001,1002);
DELETE FROM orders      WHERE order_id IN (1001,1002);
UPDATE accounts  SET balance = 8000.00 WHERE acct_id = 1;
UPDATE accounts  SET balance =12000.00 WHERE acct_id = 3;
UPDATE accounts  SET balance =  300.00 WHERE acct_id = 4;
UPDATE inventory SET stock   = 120     WHERE product_id = 101;
UPDATE inventory SET stock   =  45     WHERE product_id = 103;

SELECT '===== 1. 原子提交：一笔成功的下单 =====' AS step;

-- 下单前快照
SELECT a.user_name, a.balance, i.stock
FROM accounts a, inventory i
WHERE a.acct_id = 1 AND i.product_id = 101;

BEGIN;
  UPDATE accounts   SET balance = balance - 1299, updated_at = now() WHERE acct_id = 1;     -- 张伟付款
  UPDATE inventory  SET stock   = stock - 1                          WHERE product_id = 101; -- 扣库存
  INSERT INTO orders      VALUES (1001, 1, now(), 'PAID', 1299.00);
  INSERT INTO order_items VALUES (1001, 101, 1, 1299.00);
COMMIT;

-- 下单后：余额 -1299、库存 -1、订单已落库（四张表一致变更）
SELECT a.user_name, a.balance, i.stock
FROM accounts a, inventory i
WHERE a.acct_id = 1 AND i.product_id = 101;
SELECT * FROM orders WHERE order_id = 1001;


SELECT '===== 2. 主动回滚：事务内可见，回滚后全部撤销 =====' AS step;

SELECT balance AS `王芳_回滚前余额` FROM accounts WHERE acct_id = 3;

BEGIN;
  UPDATE accounts SET balance = balance - 5000 WHERE acct_id = 3;
  -- 事务内部能看到改动（读自己未提交的写）
  SELECT balance AS `事务内余额` FROM accounts WHERE acct_id = 3;
ROLLBACK;

-- 回滚后恢复原值，外部从未感知到中间状态（隔离性 + 原子性）
SELECT balance AS `王芳_回滚后余额` FROM accounts WHERE acct_id = 3;


SELECT '===== 3. 约束保护 + 失败回滚：余额不足，整笔交易不留痕 =====' AS step;

-- 刘强仅 300 元
SELECT user_name, balance FROM accounts WHERE acct_id = 4;
-- 无人机库存 45
SELECT stock FROM inventory WHERE product_id = 103;

BEGIN;
  UPDATE inventory SET stock = stock - 1 WHERE product_id = 103;   -- 先扣了库存
  INSERT INTO orders VALUES (1002, 4, now(), 'PENDING', 3999.00);  -- 先写了订单
  -- 这一步 balance 会变成 -3699，触发 CHECK(balance >= 0) 被数据库拒绝
  UPDATE accounts SET balance = balance - 3999 WHERE acct_id = 4;
ROLLBACK;   -- 整笔回滚：前面已经执行的扣库存、写订单也一并撤销

-- 验证：余额仍 300、库存仍 45、订单 1002 不存在 —— 没有任何「半成品」脏数据
SELECT user_name, balance FROM accounts WHERE acct_id = 4;
SELECT stock FROM inventory WHERE product_id = 103;
SELECT COUNT(*) AS `订单1002是否存在` FROM orders WHERE order_id = 1002;
