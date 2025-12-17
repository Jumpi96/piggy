-- Enable uuid-ossp extension
create extension if not exists "uuid-ossp";

-- Currencies Table
create table currencies (
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
create table exchange_rates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  currency_code text references currencies(code) not null,
  rate numeric not null,
  created_at timestamptz default now()
);

-- Credit Cards Table
create table credit_cards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) not null default auth.uid(),
  name text not null,
  closing_day integer not null check (closing_day between 1 and 31),
  payment_day integer not null check (payment_day between 1 and 31),
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- Recurring Rules Table
create table recurring_rules (
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
create table transactions (
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
  deleted_at timestamptz,

  constraint recurrence_idempotency unique (recurring_rule_id, date)
);

-- RLS Policies

alter table currencies enable row level security;
create policy "Auth read currencies" on currencies for select to authenticated using (true);

alter table exchange_rates enable row level security;
create policy "Users can all exchange_rates" on exchange_rates for all to authenticated using (user_id = auth.uid());

alter table credit_cards enable row level security;
create policy "Users can all credit_cards" on credit_cards for all to authenticated using (user_id = auth.uid());

alter table recurring_rules enable row level security;
create policy "Users can all recurring_rules" on recurring_rules for all to authenticated using (user_id = auth.uid());

alter table transactions enable row level security;
create policy "Users can all transactions" on transactions for all to authenticated using (user_id = auth.uid());
