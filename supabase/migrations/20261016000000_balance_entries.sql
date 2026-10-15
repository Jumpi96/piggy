-- Migration: Balance ledger
-- Description: The month's balance (money to move between savings and the general account
-- because of spending/income outside the budget) becomes a ledger of entries instead of a
-- to_be_balanced flag on transactions. An entry is a signed amount (> 0 = unexpected
-- expense to cover from savings, < 0 = unexpected income) in a currency; its date puts it
-- in a period. transaction_id only records which transaction it came from: entries are
-- not tied to it (editing the transaction doesn't move them). Settling a month adds a
-- 'settle' entry that brings the period's total back to 0 — no money is moved.
--
-- Every transaction flagged to_be_balanced becomes a full-amount entry linked to it, then
-- the flag column is dropped.

create table if not exists balance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  date date not null,
  amount_cents bigint not null,
  currency_code text not null references currencies(code),
  exchange_rate_id uuid references exchange_rates(id),
  transaction_id uuid references transactions(id),
  kind text not null default 'entry' check (kind in ('entry', 'settle')),
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create index if not exists idx_balance_entries_user_date on balance_entries(user_id, date);
create index if not exists idx_balance_entries_transaction on balance_entries(transaction_id);

alter table balance_entries enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all balance_entries') then
        create policy "Users can all balance_entries" on balance_entries for all to authenticated
          using (user_id = auth.uid()) with check (user_id = auth.uid());
    end if;
end $$;

drop trigger if exists set_updated_at_balance_entries on balance_entries;
create trigger set_updated_at_balance_entries before insert or update on balance_entries
  for each row execute procedure update_updated_at_column();

-- Convert the flags. Guarded so a re-run after the column is gone is a no-op.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'transactions' and column_name = 'to_be_balanced'
    ) then
        insert into balance_entries (user_id, date, amount_cents, currency_code, exchange_rate_id, transaction_id)
        select user_id,
               date,
               case when direction = 'expense' then amount_cents else -amount_cents end,
               currency_code,
               exchange_rate_id,
               id
        from transactions
        where to_be_balanced and deleted_at is null;

        alter table transactions drop column to_be_balanced;
    end if;
end $$;

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
    from import_entries where user_id = auth.uid() and deleted_at is null
  union all
  select 'balance_entries'::text, count(*)::bigint
    from balance_entries where user_id = auth.uid() and deleted_at is null;
end;
$$;
