USE demo_ingest;
DELIMITER //
CREATE TASK demo_load_catalog AS BEGIN
  INSERT INTO demo_shop.products
    (product_id, sku, name, description, category, price, stock)
  SELECT f.product_id, f.sku, f.name, f.description, f.category, f.price, f.stock
  FROM supplier_feed f
  WHERE f.price > 0 AND f.stock >= 0
    AND NOT EXISTS (
      SELECT 1 FROM demo_shop.products p WHERE p.product_id = f.product_id
    );
END//
DELIMITER ;
EXECUTE TASK demo_load_catalog;
