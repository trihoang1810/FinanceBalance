-- Supabase Migration: Security policies and debt schema fields
-- File: 20260705_security_and_debt_schema.sql
-- Description: Fix RLS policies to use valid PostgreSQL syntax, add debt tracking fields
-- Run in Supabase migrations or manually in the SQL editor

-- =============================================================================
-- SECTION 1: ADD NEW SCHEMA COLUMNS FOR DEBT TRACKING
-- =============================================================================

ALTER TABLE public.debt_plans
  ADD COLUMN IF NOT EXISTS anchor_date date,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS last_settled_period text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS sequence bigint;

-- =============================================================================
-- SECTION 2: ENABLE ROW LEVEL SECURITY (already enabled, but explicit for clarity)
-- =============================================================================

ALTER TABLE IF EXISTS public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.debt_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.debt_entries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SECTION 3: APP_SETTINGS POLICIES (valid PostgreSQL syntax)
-- =============================================================================

DROP POLICY IF EXISTS "app settings select" ON public.app_settings;
CREATE POLICY "app settings select"
ON public.app_settings
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "app settings insert" ON public.app_settings;
CREATE POLICY "app settings insert"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "app settings update" ON public.app_settings;
CREATE POLICY "app settings update"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "app settings delete" ON public.app_settings;
CREATE POLICY "app settings delete"
ON public.app_settings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 4: ACCOUNTS POLICIES
-- =============================================================================

DROP POLICY IF EXISTS "accounts select" ON public.accounts;
CREATE POLICY "accounts select"
ON public.accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "accounts insert" ON public.accounts;
CREATE POLICY "accounts insert"
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "accounts update" ON public.accounts;
CREATE POLICY "accounts update"
ON public.accounts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "accounts delete" ON public.accounts;
CREATE POLICY "accounts delete"
ON public.accounts
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 5: CATEGORIES POLICIES
-- =============================================================================

DROP POLICY IF EXISTS "categories select" ON public.categories;
CREATE POLICY "categories select"
ON public.categories
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "categories insert" ON public.categories;
CREATE POLICY "categories insert"
ON public.categories
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "categories update" ON public.categories;
CREATE POLICY "categories update"
ON public.categories
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "categories delete" ON public.categories;
CREATE POLICY "categories delete"
ON public.categories
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 6: TRANSACTIONS POLICIES
-- =============================================================================

DROP POLICY IF EXISTS "transactions select" ON public.transactions;
CREATE POLICY "transactions select"
ON public.transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "transactions insert" ON public.transactions;
CREATE POLICY "transactions insert"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "transactions update" ON public.transactions;
CREATE POLICY "transactions update"
ON public.transactions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "transactions delete" ON public.transactions;
CREATE POLICY "transactions delete"
ON public.transactions
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 7: DEBT_PLANS POLICIES
-- =============================================================================

DROP POLICY IF EXISTS "debt plans select" ON public.debt_plans;
CREATE POLICY "debt plans select"
ON public.debt_plans
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt plans insert" ON public.debt_plans;
CREATE POLICY "debt plans insert"
ON public.debt_plans
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt plans update" ON public.debt_plans;
CREATE POLICY "debt plans update"
ON public.debt_plans
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt plans delete" ON public.debt_plans;
CREATE POLICY "debt plans delete"
ON public.debt_plans
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 8: DEBT_ENTRIES POLICIES
-- =============================================================================

DROP POLICY IF EXISTS "debt entries select" ON public.debt_entries;
CREATE POLICY "debt entries select"
ON public.debt_entries
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt entries insert" ON public.debt_entries;
CREATE POLICY "debt entries insert"
ON public.debt_entries
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt entries update" ON public.debt_entries;
CREATE POLICY "debt entries update"
ON public.debt_entries
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "debt entries delete" ON public.debt_entries;
CREATE POLICY "debt entries delete"
ON public.debt_entries
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 9: COMPOSITE INDEXES FOR COMMON QUERIES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_app_settings_user_id
ON public.app_settings (user_id);

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at
ON public.app_settings (updated_at);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id
ON public.accounts (user_id);

CREATE INDEX IF NOT EXISTS idx_accounts_updated_at
ON public.accounts (updated_at);

CREATE INDEX IF NOT EXISTS idx_categories_user_id
ON public.categories (user_id);

CREATE INDEX IF NOT EXISTS idx_categories_updated_at
ON public.categories (updated_at);

CREATE INDEX IF NOT EXISTS idx_transactions_user_updated
ON public.transactions (user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_debt_plans_user_updated
ON public.debt_plans (user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_debt_plans_next_due
ON public.debt_plans (user_id, next_due_date);

CREATE INDEX IF NOT EXISTS idx_debt_entries_user_plan
ON public.debt_entries (user_id, plan_id);

-- =============================================================================
-- SECTION 10: DATA BACKFILL (safe defaults for new fields)
-- =============================================================================

-- Backfill sequence for transactions (epoch milliseconds for ordering)
-- Only for transactions that don't already have a sequence value
UPDATE public.transactions
SET sequence = (EXTRACT(EPOCH FROM created_at) * 1000)::bigint
WHERE sequence IS NULL;

-- END OF MIGRATION
