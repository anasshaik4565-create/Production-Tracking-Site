-- =====================================================================
-- Migration A (run FIRST, on its own): new production stages
--   Foam Placement  -> sits just before Packing
--   Palletization   -> sits just after Packing
-- Existing projects, panels and production records are not touched.
-- Safe to run more than once.
-- =====================================================================
ALTER TYPE public.prod_stage ADD VALUE IF NOT EXISTS 'foam_placement' BEFORE 'packing';
ALTER TYPE public.prod_stage ADD VALUE IF NOT EXISTS 'palletization' AFTER 'packing';
