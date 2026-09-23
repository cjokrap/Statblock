-- Statblock: Open Food Facts products you log become foods
--
-- Barcode scanning looks products up in Open Food Facts (OFF). Its data is
-- ODbL (share-alike). Only products a user actually logs are saved: the
-- original JSON in off_products, and a foods row (source 'off', source_id =
-- barcode) so food_log, search and the rules engine treat it like any other
-- packaged food. Using individual products like this is an insubstantial
-- part of OFF; the app credits Open Food Facts wherever it shows them. Both
-- are written by the server (service role) only, like USDA packaged foods.
alter table public.foods drop constraint foods_source_check;
alter table public.foods add constraint foods_source_check check (source in
  ('usda_foundation', 'usda_sr_legacy', 'usda_survey', 'usda_branded', 'off', 'custom'));
