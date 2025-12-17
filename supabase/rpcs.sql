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

-- Ensure Recurring Generated
create or replace function ensure_recurring_generated(until_date date)
returns void
language plpgsql
security definer
as $$
declare
  r record;
  next_date date;
  er_id uuid;
begin
  -- First: Cleanup future transactions for rules that have an end_date or are inactive
  for r in (
    select * from recurring_rules 
    where user_id = auth.uid()
      and deleted_at is null
  ) loop
    
    -- Soft-delete transactions that are no longer in scope for this rule
    update transactions 
    set deleted_at = now()
    where recurring_rule_id = r.id
      and deleted_at is null
      and (
        date < r.start_date 
        or (r.end_date is not null and date > r.end_date)
        or (not r.active and date > current_date) -- If inactive, stop future ones
      );

    -- Only generate for ACTIVE rules
    if r.active then
        next_date := r.start_date;
        
        for i in 1..500 loop
           exit when next_date > until_date;
           exit when r.end_date is not null and next_date > r.end_date;
           
           -- Find latest exchange rate for this currency
           select id into er_id from exchange_rates 
           where currency_code = r.currency_code 
             and user_id = auth.uid()
           order by created_at desc
           limit 1;
           
           -- Insert (idempotent)
           insert into transactions (
             user_id, date, direction, amount_cents, currency_code, exchange_rate_id,
             category, tag, payment_method, credit_card_id, recurring_rule_id, to_be_balanced, note
           ) values (
             auth.uid(), next_date, r.direction, r.amount_cents, r.currency_code, er_id,
             r.category, r.tag, r.payment_method, r.credit_card_id, r.id, false, r.note
           )
           on conflict (recurring_rule_id, date) do update 
           set 
             amount_cents = excluded.amount_cents,
             category = excluded.category,
             tag = excluded.tag,
             direction = excluded.direction,
             payment_method = excluded.payment_method,
             credit_card_id = excluded.credit_card_id,
             note = excluded.note,
             deleted_at = null
           where (transactions.date >= current_date) -- IMPACT ONLY FUTURE (or today)
             and (transactions.deleted_at is not null or 
                  transactions.amount_cents != excluded.amount_cents or 
                  transactions.category != excluded.category or 
                  transactions.tag != excluded.tag or
                  transactions.note is distinct from excluded.note);

           -- Advance next_date
           if r.schedule_type = 'monthly_day' then
              next_date := next_date + interval '1 month';
           elsif r.schedule_type = 'every_n_days' then
              next_date := next_date + (r.schedule_config->>'n')::int * interval '1 day';
           elsif r.schedule_type = 'every_n_months' then
              next_date := next_date + (r.schedule_config->>'n')::int * interval '1 month';
           else
              exit;
           end if;
        end loop;
    end if;

  end loop;
end;
$$;
