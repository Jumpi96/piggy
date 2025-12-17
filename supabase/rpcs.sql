-- RPC: Compute Month Balance
-- Returns the balance in USD cents for a given month (YYYY-MM-01)
-- Returns { "income": X, "expense": Y, "balance": Z }
create or replace function compute_month_balance(target_month date)
returns json
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

  return json_build_object(
    'income', total_income,
    'expense', total_expense,
    'balance', total_income - total_expense
  );
end;
$$;

-- RPC: Repoint Exchange Rate
-- Updates all transactions of a currency from a certain date onwards to use a new rate
create or replace function repoint_exchange_rate(p_currency_code text, p_start_date date, p_new_rate_id uuid)
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
    and date >= p_start_date
    and deleted_at is null;
end;
$$;

-- RPC: Ensure Recurring Generated
create or replace function ensure_recurring_generated(until_date date)
returns void
language plpgsql
security definer
as $$
declare
  r record;
  last_tx_date date;
  next_date date;
  occ_count integer;
  er_id uuid;
begin
  -- Iterate active rules
  for r in select * from recurring_rules where user_id = auth.uid() and active = true and deleted_at is null loop
    
    -- Check total occurrences if set
    if r.total_occurrences is not null then
      select count(*) into occ_count from transactions where recurring_rule_id = r.id and deleted_at is null;
      if occ_count >= r.total_occurrences then
        continue; -- Skip this rule, quota met
      end if;
    end if;

    -- Find last occurrence
    select max(date) into last_tx_date from transactions where recurring_rule_id = r.id;
    
    if last_tx_date is null then
      next_date := r.start_date;
    else
      -- Calculate next based on schedule
      if r.schedule_type = 'monthly_day' then
        -- Add 1 month to last date (simplified)
        next_date := last_tx_date + interval '1 month';
      elsif r.schedule_type = 'every_n_days' then
        next_date := last_tx_date + (r.schedule_config->>'n')::int * interval '1 day';
      elsif r.schedule_type = 'every_n_months' then
        next_date := last_tx_date + (r.schedule_config->>'n')::int * interval '1 month';
      end if;
    end if;

    -- Generate until next_date > until_date
    while next_date <= until_date loop
       -- Double check quota inside loop
       if r.total_occurrences is not null then
         select count(*) into occ_count from transactions where recurring_rule_id = r.id and deleted_at is null;
         if occ_count >= r.total_occurrences then
           exit; 
         end if;
       end if;

       -- Find latest exchange rate for this currency
       select id into er_id from exchange_rates 
       where currency_code = r.currency_code 
         and user_id = auth.uid()
       order by created_at desc
       limit 1;
       
       -- Insert
       insert into transactions (
         user_id, date, direction, amount_cents, currency_code, exchange_rate_id,
         category, tag, payment_method, credit_card_id, recurring_rule_id, to_be_balanced
       ) values (
         auth.uid(), next_date, r.direction, r.amount_cents, r.currency_code, er_id,
         r.category, r.tag, r.payment_method, r.credit_card_id, r.id, false
       )
       on conflict (recurring_rule_id, date) do nothing;

       -- Advance next_date
       if r.schedule_type = 'monthly_day' then
          next_date := next_date + interval '1 month';
       elsif r.schedule_type = 'every_n_days' then
          next_date := next_date + (r.schedule_config->>'n')::int * interval '1 day';
       elsif r.schedule_type = 'every_n_months' then
          next_date := next_date + (r.schedule_config->>'n')::int * interval '1 month';
       else
          exit; -- Unknown type
       end if;
    end loop;

  end loop;
end;
$$;
