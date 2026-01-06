-- Migration: Add updated_at columns and triggers
-- Description: Ensures all sync tables have updated_at and a trigger to update it automatically.

-- 1. Create the update function if it doesn't exist
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- 2. Add updated_at to tables that are missing it
alter table currencies add column if not exists updated_at timestamptz default now();
alter table exchange_rates add column if not exists updated_at timestamptz default now();
alter table credit_cards add column if not exists updated_at timestamptz default now();
alter table recurring_rules add column if not exists updated_at timestamptz default now();

-- Note: transactions and parameters already have it from schema.sql, but we ensure they have triggers below.

-- 3. Add triggers to all sync tables
do $$
begin
    -- Currencies
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_currencies') then
        create trigger set_updated_at_currencies before update on currencies for each row execute procedure update_updated_at_column();
    end if;

    -- Exchange Rates
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_exchange_rates') then
        create trigger set_updated_at_exchange_rates before update on exchange_rates for each row execute procedure update_updated_at_column();
    end if;

    -- Credit Cards
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_credit_cards') then
        create trigger set_updated_at_credit_cards before update on credit_cards for each row execute procedure update_updated_at_column();
    end if;

    -- Recurring Rules
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_recurring_rules') then
        create trigger set_updated_at_recurring_rules before update on recurring_rules for each row execute procedure update_updated_at_column();
    end if;

    -- Transactions
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_transactions') then
        create trigger set_updated_at_transactions before update on transactions for each row execute procedure update_updated_at_column();
    end if;

    -- Parameters
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_parameters') then
        create trigger set_updated_at_parameters before update on parameters for each row execute procedure update_updated_at_column();
    end if;
end $$;
