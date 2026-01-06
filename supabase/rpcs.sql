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
    -- target_month is expected to be 'YYYY-MM-01'
    
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
