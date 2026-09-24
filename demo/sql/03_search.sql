USE demo_shop_ci;
CREATE FULLTEXT INDEX ft_products ON products (name, description);
CREATE INDEX vec_products USING IVFFLAT ON products(embedding)
  LISTS=3 OP_TYPE 'vector_l2_ops';
