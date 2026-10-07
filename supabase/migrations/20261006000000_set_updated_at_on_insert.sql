-- Migration: Stamp updated_at on INSERT as well as UPDATE
-- Description: The set_updated_at_* triggers only fired BEFORE UPDATE, so inserted rows kept
-- whatever updated_at the client sent: NULL for credit cards, the device's creation time for
-- transactions/parameters. Incremental pull filters on updated_at >= last sync, so a row created
-- offline and pushed later (or with NULL) was never pulled by other devices; only the count
-- reconciliation's full-table resync recovered it. Server time on insert makes updated_at a
-- reliable "when did the server see this" watermark.

do $$
declare
    t text;
begin
    foreach t in array array['currencies', 'exchange_rates', 'credit_cards', 'recurring_rules', 'transactions', 'parameters']
    loop
        execute format('drop trigger if exists set_updated_at_%1$s on %1$I', t);
        execute format(
            'create trigger set_updated_at_%1$s before insert or update on %1$I for each row execute procedure update_updated_at_column()',
            t
        );
    end loop;
end $$;
