-- Get Sync Counts for Reconciliation
-- Returns record counts per table for the current user
-- Used by client-side reconciliation to detect missing records
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
    from parameters where user_id = auth.uid();
end;
$$;
