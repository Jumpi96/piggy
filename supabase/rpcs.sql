-- RPC: Compute Month Balance
-- Returns the balance in USD cents for a given month (YYYY-MM-01)
create or replace function compute_month_balance(target_month date)
returns bigint
language plpgsql
security definer
as $$
declare
  total_income bigint;
  total_expense bigint;
begin
  -- Sum income (cents / rate)
  select coalesce(sum(t.amount_cents / er.rate), 0)
  into total_income
  from transactions t
  join exchange_rates er on t.exchange_rate_id = er.id
  where t.user_id = auth.uid()
    and date_trunc('month', t.date) = date_trunc('month', target_month)
    and t.direction = 'income'
    and t.deleted_at is null;

  -- Sum expense
  select coalesce(sum(t.amount_cents / er.rate), 0)
  into total_expense
  from transactions t
  join exchange_rates er on t.exchange_rate_id = er.id
  where t.user_id = auth.uid()
    and date_trunc('month', t.date) = date_trunc('month', target_month)
    and t.direction = 'expense'
    and t.deleted_at is null;

  return total_income - total_expense;
end;
$$;

-- RPC: Repoint Exchange Rate
-- Updates all transactions of a currency in a month to use a new rate
create or replace function repoint_exchange_rate(p_currency_code text, p_month date, p_new_rate_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update transactions
  set exchange_rate_id = p_new_rate_id,
      updated_at = now()
  where user_id = auth.uid()
    and currency_code = p_currency_code
    and date_trunc('month', date) = date_trunc('month', p_month)
    and deleted_at is null;
end;
$$;

-- RPC: Ensure Recurring Generated
-- This is a simplified version. Full date logic is complex in SQL.
-- We will handle the actual generation logic in the Application Layer (Typescript) if possible, 
-- OR use a more advanced PL/pgSQL block. 
-- For v1, let's assume the client might call an endpoint or we just define the interface.
-- However, strict adherence to the plan says "Lazy recurring generation via Supabase RPC".
-- So we should try.

create or replace function ensure_recurring_generated(until_date date)
returns void
language plpgsql
security definer
as $$
declare
  r record;
  next_date date;
begin
  -- This is a placeholder for the complex generation logic.
  -- Iterating through rules and inserting transactions.
  
  -- For each active rule
  for r in select * from recurring_rules where user_id = auth.uid() and active = true and deleted_at is null loop
    -- Determine the last generated date for this rule
    -- If none, start from start_date
    -- Loop until next_date > until_date
    -- Insert transaction
    -- Handle constraints (idempotency)
    null; -- TODO: Implement full recurrence logic
  end loop;
end;
$$;
