DROP PITR IF EXISTS demo_price_history;
DROP DATABASE IF EXISTS demo_pitr_shop;
DROP TASK IF EXISTS demo_load_catalog;
DROP PITR IF EXISTS demo_cdc_pitr;
DROP PUBLICATION IF EXISTS demo_catalog;
DROP ACCOUNT IF EXISTS demo_partner;
DROP DATABASE IF EXISTS demo_shop_ci;
DROP DATABASE IF EXISTS demo_ingest;
DROP DATABASE IF EXISTS demo_shop;
DROP STAGE IF EXISTS demo_supplier;
DROP SNAPSHOT IF EXISTS demo_promo_base;
DROP SNAPSHOT IF EXISTS demo_before_accident;

CREATE DATABASE demo_ingest;
CREATE DATABASE demo_shop;
USE demo_ingest;
CREATE STAGE demo_supplier URL='file://__DATA_DIR__/';
CREATE EXTERNAL TABLE supplier_feed (
  product_id BIGINT,
  sku VARCHAR(40),
  name VARCHAR(120),
  description TEXT,
  category VARCHAR(40),
  price DECIMAL(10,2),
  stock INT
) INFILE{'filepath'='stage://demo_supplier/products.csv', 'format'='csv'}
FIELDS TERMINATED BY ',' IGNORE 1 LINES;
CREATE TABLE quality_issues (
  product_id BIGINT PRIMARY KEY,
  issue VARCHAR(80)
);
INSERT INTO quality_issues
SELECT product_id, 'price or stock is invalid'
FROM supplier_feed WHERE price <= 0 OR stock < 0;

USE demo_shop;
CREATE TABLE products (
  product_id BIGINT PRIMARY KEY,
  sku VARCHAR(40),
  name VARCHAR(120),
  description TEXT,
  category VARCHAR(40),
  price DECIMAL(10,2),
  stock INT,
  embedding VECF32(4)
);
CREATE TABLE orders (
  order_id BIGINT PRIMARY KEY,
  product_id BIGINT,
  qty INT,
  amount DECIMAL(12,2),
  created_at DATETIME
);
CREATE TABLE product_docs (
  doc_id BIGINT PRIMARY KEY,
  product_id BIGINT,
  manual DATALINK,
  FULLTEXT(manual)
);
