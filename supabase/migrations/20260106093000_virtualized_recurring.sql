-- Migration: Virtualized Recurring Transactions
-- Description: Add columns for exceptions and overrides, and update idempotency constraint.

-- 1. Add exception_dates to recurring_rules
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS exception_dates JSONB;

-- 2. Add original_date to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_date DATE;

-- 3. Update the unique constraint on transactions
DO $$
BEGIN
    -- Drop the old one if it exists (linked to 'date')
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurrence_idempotency') THEN
        -- Check if it's already the NEW one (linked to 'original_date')
        -- We check by looking at the column names in the index/constraint
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_attribute a 
            JOIN pg_index i ON a.attrelid = i.indrelid 
            JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relname = 'recurrence_idempotency'
            AND a.attname = 'original_date'
        ) THEN
            ALTER TABLE transactions DROP CONSTRAINT recurrence_idempotency;
            
            -- Set original_date for existing physical recurring transactions
            UPDATE transactions 
            SET original_date = date 
            WHERE recurring_rule_id IS NOT NULL AND original_date IS NULL;

            -- Add the new constraint
            ALTER TABLE transactions ADD CONSTRAINT recurrence_idempotency UNIQUE (recurring_rule_id, original_date);
        END IF;
    ELSE
        -- Just add it if it doesn't exist at all
        ALTER TABLE transactions ADD CONSTRAINT recurrence_idempotency UNIQUE (recurring_rule_id, original_date);
    END IF;
END $$;
