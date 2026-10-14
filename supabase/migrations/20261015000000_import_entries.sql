-- Migration: Import entries (the Inbox)
-- Description: Movements pulled automatically from Mercado Pago (release report) and Santander
-- (alert emails) land here as unconfirmed entries. They are inserted only by the importer Lambdas,
-- which connect as the database owner; the app can read them and change their status (confirm →
-- creates a transaction, dismiss, reopen) but never inserts or deletes them.
-- (user_id, source, external_id) is the dedupe key: importers insert ... on conflict do nothing,
-- so re-runs never overwrite what was done in the app.

create table if not exists import_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null,
  source text not null check (source in ('mercadopago', 'santander')),
  external_id text not null,
  kind text not null check (kind in ('card_purchase', 'debit_purchase', 'transfer_out', 'transfer_in', 'mp_outflow', 'mp_interest', 'unknown')),
  date date,
  direction text check (direction in ('income', 'expense')),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency_code text references currencies(code),
  description text,
  account_ref text,
  installments integer,
  raw jsonb,
  parse_error text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  transaction_id uuid references transactions(id),
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  unique (user_id, source, external_id)
);

create index if not exists idx_import_entries_user_status on import_entries(user_id, status);

alter table import_entries enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can read import_entries') then
        create policy "Users can read import_entries" on import_entries for select to authenticated using (user_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where policyname = 'Users can update import_entries') then
        create policy "Users can update import_entries" on import_entries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    end if;
end $$;

drop trigger if exists set_updated_at_import_entries on import_entries;
create trigger set_updated_at_import_entries before insert or update on import_entries
  for each row execute procedure update_updated_at_column();

create or replace function get_sync_counts()
returns table (table_name text, record_count bigint)
language plpgsql
security definer
as $$
begin
  return query
  select 'transactions'::text, count(*)::bigint
    from transactions where user_id = auth.uid() and deleted_at is null
  union all
  select 'recurring_rules'::text, count(*)::bigint
    from recurring_rules where user_id = auth.uid() and deleted_at is null
  union all
  select 'credit_cards'::text, count(*)::bigint
    from credit_cards where user_id = auth.uid() and deleted_at is null
  union all
  select 'exchange_rates'::text, count(*)::bigint
    from exchange_rates where user_id = auth.uid()
  union all
  select 'parameters'::text, count(*)::bigint
    from parameters where user_id = auth.uid()
  union all
  select 'import_entries'::text, count(*)::bigint
    from import_entries where user_id = auth.uid() and deleted_at is null;
end;
$$;
