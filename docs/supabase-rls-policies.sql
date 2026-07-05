-- Supabase RLS policies and indexes for FinanceBalance tables
-- Run this migration in Supabase only after reviewing and applying in the correct environment.

-- Enable Row Level Security
ALTER TABLE IF EXISTS public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.debt_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.debt_entries ENABLE ROW LEVEL SECURITY;

-- Policies for app_settings
CREATE POLICY IF NOT EXISTS "app settings select" ON public.app_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "app settings insert" ON public.app_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "app settings update" ON public.app_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "app settings delete" ON public.app_settings
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for accounts
CREATE POLICY IF NOT EXISTS "accounts select" ON public.accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "accounts insert" ON public.accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "accounts update" ON public.accounts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "accounts delete" ON public.accounts
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for categories
CREATE POLICY IF NOT EXISTS "categories select" ON public.categories
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "categories insert" ON public.categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "categories update" ON public.categories
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "categories delete" ON public.categories
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for transactions
CREATE POLICY IF NOT EXISTS "transactions select" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "transactions insert" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "transactions update" ON public.transactions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "transactions delete" ON public.transactions
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for debt_plans
CREATE POLICY IF NOT EXISTS "debt plans select" ON public.debt_plans
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt plans insert" ON public.debt_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt plans update" ON public.debt_plans
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt plans delete" ON public.debt_plans
  FOR DELETE USING (auth.uid() = user_id);

-- Policies for debt_entries
CREATE POLICY IF NOT EXISTS "debt entries select" ON public.debt_entries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt entries insert" ON public.debt_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt entries update" ON public.debt_entries
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "debt entries delete" ON public.debt_entries
  FOR DELETE USING (auth.uid() = user_id);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON public.app_settings (user_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON public.app_settings (updated_at);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_updated_at ON public.accounts (updated_at);

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories (user_id);
CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON public.categories (updated_at);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_updated_at ON public.transactions (updated_at);

CREATE INDEX IF NOT EXISTS idx_debt_plans_user_id ON public.debt_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_debt_plans_updated_at ON public.debt_plans (updated_at);

CREATE INDEX IF NOT EXISTS idx_debt_entries_user_id ON public.debt_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_debt_entries_updated_at ON public.debt_entries (updated_at);
