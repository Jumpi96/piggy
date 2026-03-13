-- Migration: Fix recurrence_idempotency constraint
-- The constraint should be on (recurring_rule_id, original_date), not (recurring_rule_id, date)

-- First, set original_date for any existing overrides that don't have it
UPDATE transactions
SET original_date = date
WHERE recurring_rule_id IS NOT NULL AND original_date IS NULL;

-- Drop the old constraint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS recurrence_idempotency;

-- Add the correct constraint
ALTER TABLE transactions ADD CONSTRAINT recurrence_idempotency UNIQUE (recurring_rule_id, original_date);
