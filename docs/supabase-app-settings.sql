create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'VND',
  theme_label text not null default 'dark-green',
  monthly_expense_target numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "Users can read their own app settings"
on public.app_settings
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own app settings"
on public.app_settings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own app settings"
on public.app_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own app settings"
on public.app_settings
for delete
to authenticated
using (auth.uid() = user_id);
