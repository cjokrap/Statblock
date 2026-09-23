-- Statblock: a daily fiber goal
--
-- Fiber shows with the other macros on Today, counting food and the daily
-- stack (supplement_nutrients). fiber_g is the goal; null means the app's
-- suggestion, 14 g per 1,000 kcal of the calorie target (Dietary Guidelines
-- for Americans). Effective-dated like every other target.
alter table public.user_settings
  add column fiber_g integer check (fiber_g between 0 and 150);
