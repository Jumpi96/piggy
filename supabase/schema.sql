-- Enable uuid-ossp extension
create extension if not exists "uuid-ossp";

-- Function to handle updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- Currencies Table
create table if not exists currencies (
  code text primary key,
  name text not null,
  updated_at timestamptz default now()
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Credit Cards Table
create table if not exists credit_cards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  name text not null,
  closing_day integer not null check (closing_day between 1 and 31),
  payment_day integer not null check (payment_day between 1 and 31),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
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
  exception_dates jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
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
  original_date date,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Idempotent constraint for transactions
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'recurrence_idempotency') then
        alter table transactions add constraint recurrence_idempotency unique (recurring_rule_id, original_date);
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

-- Import Entries Table (the Inbox): unconfirmed movements inserted by the importer Lambdas.
-- The app only reads them and changes their status. (user_id, source, external_id) dedupes re-runs.
create table if not exists import_entries (
  id uuid primary key default gen_random_uuid(),
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

-- Balance Entries Table: the month's balance ledger. Signed amount (> 0 = unexpected expense
-- to cover from savings, < 0 = unexpected income); the date puts it in a period.
-- transaction_id only records where an entry came from. 'settle' entries zero a period.
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

alter table balance_entries enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can all balance_entries') then
        create policy "Users can all balance_entries" on balance_entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
    end if;
end $$;

-- Triggers for all tables
do $$
begin
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_currencies') then
        create trigger set_updated_at_currencies before insert or update on currencies for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_exchange_rates') then
        create trigger set_updated_at_exchange_rates before insert or update on exchange_rates for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_credit_cards') then
        create trigger set_updated_at_credit_cards before insert or update on credit_cards for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_recurring_rules') then
        create trigger set_updated_at_recurring_rules before insert or update on recurring_rules for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_transactions') then
        create trigger set_updated_at_transactions before insert or update on transactions for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_parameters') then
        create trigger set_updated_at_parameters before insert or update on parameters for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_import_entries') then
        create trigger set_updated_at_import_entries before insert or update on import_entries for each row execute procedure update_updated_at_column();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_balance_entries') then
        create trigger set_updated_at_balance_entries before insert or update on balance_entries for each row execute procedure update_updated_at_column();
    end if;
end $$;
