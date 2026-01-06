-- Migration: Initial Schema
-- Timestamp: 20241221000000

-- Enable uuid-ossp extension
create extension if not exists "uuid-ossp";

-- Currencies Table
create table if not exists currencies (
  code text primary key,
  name text not null
);

-- Insert default currencies
insert into currencies (code, name) values 
  ('USD', 'United States Dollar'),
  ('ARS', 'Argentine Peso'),
  ('EUR', 'Euro')
on conflict (code) do nothing;

-- Exchange Rates Table
create table if not exists exchange_rates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  currency_code text references currencies(code) not null,
  rate numeric not null,
  created_at timestamptz default now()
);

-- Credit Cards Table
create table if not exists credit_cards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  name text not null,
  closing_day integer not null check (closing_day between 1 and 31),
  payment_day integer not null check (payment_day between 1 and 31),
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- Recurring Rules Table
create table if not exists recurring_rules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  direction text not null check (direction in ('income', 'expense')),
  amount_cents bigint not null,
  currency_code text references currencies(code) not null,
  category text not null,
  tag text not null,
  payment_method text not null check (payment_method in ('cash', 'card')),
  credit_card_id uuid references credit_cards(id),
  schedule_type text not null, -- monthly_day, every_n_days, every_n_months
  schedule_config jsonb not null,
  start_date date not null,
  end_date date,
  active boolean default true,
  note text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- Transactions Table
create table if not exists transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  date date not null,
  direction text not null check (direction in ('income', 'expense')),
  amount_cents bigint not null,
  currency_code text references currencies(code) not null,
  exchange_rate_id uuid references exchange_rates(id),
  category text not null,
  tag text not null,
  payment_method text not null check (payment_method in ('cash', 'card')),
  credit_card_id uuid references credit_cards(id),
  recurring_rule_id uuid references recurring_rules(id),
  to_be_balanced boolean not null default false,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Initial constraint for transactions
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'recurrence_idempotency') then
        alter table transactions add constraint recurrence_idempotency unique (recurring_rule_id, date);
    end if;
end $$;

-- Parameters Table
create table if not exists parameters (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now(),
  unique(user_id, key)
);

-- RLS Policies
alter table currencies enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Auth read currencies') then
        create policy "Auth read currencies" on currencies for select to authenticated using (true);
    end if;
end $$;

alter table exchange_rates enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all exchange_rates') then
        create policy "Users can all exchange_rates" on exchange_rates for all to authenticated using (user_id = auth.uid());
    end if;
end $$;

alter table credit_cards enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all credit_cards') then
        create policy "Users can all credit_cards" on credit_cards for all to authenticated using (user_id = auth.uid());
    end if;
end $$;

alter table recurring_rules enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all recurring_rules') then
        create policy "Users can all recurring_rules" on recurring_rules for all to authenticated using (user_id = auth.uid());
    end if;
end $$;

alter table transactions enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all transactions') then
        create policy "Users can all transactions" on transactions for all to authenticated using (user_id = auth.uid());
    end if;
end $$;

alter table parameters enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all parameters') then
        create policy "Users can all parameters" on parameters for all to authenticated using (user_id = auth.uid());
    end if;
end $$;

-- RPCs
-- Compute Month Balance
create or replace function compute_month_balance(target_month date)
returns json
language plpgsql
security definer
as $$
declare
    income bigint;
    expense bigint;
begin
    select coalesce(sum(case when t.direction = 'income' then t.amount_cents / coalesce(er.rate, 1) else 0 end), 0)
    into income
    from transactions t
    left join exchange_rates er on t.exchange_rate_id = er.id
    where t.date >= target_month 
      and t.date < target_month + interval '1 month'
      and t.deleted_at is null
      and t.user_id = auth.uid();

    select coalesce(sum(case when t.direction = 'expense' then t.amount_cents / coalesce(er.rate, 1) else 0 end), 0)
    into expense
    from transactions t
    left join exchange_rates er on t.exchange_rate_id = er.id
    where t.date >= target_month 
      and t.date < target_month + interval '1 month'
      and t.deleted_at is null
      and t.user_id = auth.uid();

    return json_build_object(
        'income', income,
        'expense', expense,
        'balance', income - expense
    );
end;
$$;

-- Repoint Exchange Rate
create or replace function repoint_exchange_rate(
  p_currency_code text,
  p_start_date date,
  p_new_rate_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  update transactions
  set exchange_rate_id = p_new_rate_id
  where currency_code = p_currency_code
    and user_id = auth.uid()
    and date >= p_start_date;
end;
$$;

-- Fetch Distinct Tags
create or replace function fetch_distinct_tags()
returns table (tag text)
language sql
security definer
as $$
  select distinct tag 
  from transactions 
  where deleted_at is null 
    and user_id = auth.uid()
  order by tag;
$$;
