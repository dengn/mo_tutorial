-- Fixed names only: this deliberately leaves all other databases untouched.
DROP TASK IF EXISTS demo_load_catalog;
DROP PITR IF EXISTS demo_cdc_pitr;
DROP PITR IF EXISTS demo_price_history;
DROP PUBLICATION IF EXISTS demo_catalog;
DROP ACCOUNT IF EXISTS demo_partner;
DROP SNAPSHOT IF EXISTS demo_promo_base;
DROP SNAPSHOT IF EXISTS demo_before_accident;
DROP DATABASE IF EXISTS demo_shop_ci;
DROP DATABASE IF EXISTS demo_ingest;
DROP DATABASE IF EXISTS demo_pitr_shop;
DROP DATABASE IF EXISTS demo_story_lake;
DROP DATABASE IF EXISTS demo_shop;
DROP STAGE IF EXISTS demo_supplier;
-- Retain demo_story_ice and its access mapping as connection configuration.
-- v4.2.4 rejects DROP while principal/residency metadata references the catalog.
