import { supabase } from './supabase';
import type { Currency, CreditCard, Transaction, RecurringRule } from '../types';

export async function fetchCurrencies(): Promise<Currency[]> {
    const { data, error } = await supabase
        .from('currencies')
        .select('*')
        .order('code');

    if (error) throw error;
    return data || [];
}

export async function fetchCreditCards(): Promise<CreditCard[]> {
    const { data, error } = await supabase
        .from('credit_cards')
        .select('*')
        .is('deleted_at', null)
        .order('name');

    if (error) throw error;
    return data || [];
}

// Transaction Input without system fields
export type TransactionInput = Omit<Transaction, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>;

export async function insertTransaction(transaction: TransactionInput) {
    const { data, error } = await supabase
        .from('transactions')
        .insert(transaction)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateTransaction(id: string, updates: Partial<TransactionInput>) {
    const { data, error } = await supabase
        .from('transactions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deleteTransaction(id: string) {
    const { error } = await supabase
        .from('transactions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
}

export async function fetchTransactions(monthStart: string): Promise<Transaction[]> {
    // monthStart should be YYYY-MM-01
    // Filter by date range and NOT deleted
    // We can filter by date >= monthStart AND date < monthStart + 1 month

    // Easier: client-side filter or exact match on month part?
    // Let's do simple range query.

    const start = new Date(monthStart);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const { data, error } = await supabase
        .from('transactions')
        .select('*, exchange_rate:exchange_rates(rate), credit_card:credit_cards(name)')
        .is('deleted_at', null)
        .gte('date', start.toISOString().split('T')[0])
        .lt('date', end.toISOString().split('T')[0])
        .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
}

export async function fetchExchangeRate(currencyCode: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('exchange_rates')
        .select('id')
        .eq('currency_code', currencyCode)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Error fetching rate", error);
        return null;
    }
    return data?.id || null;
}

export async function fetchDistinctTags(): Promise<string[]> {
    // For v1 scale, fetching all tags and deduplicating client-side is acceptable.
    // Ideally this should be an RPC like `select distinct tag from transactions`.

    // We limit to last 500 transactions to guess "recent/frequent" usage if we don't have an RPC.
    const { data, error } = await supabase
        .from('transactions')
        .select('tag')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error("Error fetching tags", error);
        return [];
    }

    if (!data) return [];

    // Count frequency
    const freq: Record<string, number> = {};
    for (const row of data) {
        freq[row.tag] = (freq[row.tag] || 0) + 1;
    }

    // Sort by frequency desc
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag);
}

export async function insertCreditCard(name: string, closingDay: number, paymentDay: number) {
    const { data, error } = await supabase
        .from('credit_cards')
        .insert({ name, closing_day: closingDay, payment_day: paymentDay })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteCreditCard(id: string) {
    const { error } = await supabase
        .from('credit_cards')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

export async function insertExchangeRate(currencyCode: string, rate: number) {
    const { data, error } = await supabase
        .from('exchange_rates')
        .insert({ currency_code: currencyCode, rate })
        .select()
        .single();

    if (error) throw error;

    // Repoint transactions from the start of the current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const dateStr = startOfMonth.toISOString().split('T')[0];

    const { error: rpcError } = await supabase.rpc('repoint_exchange_rate', {
        p_currency_code: currencyCode,
        p_start_date: dateStr,
        p_new_rate_id: data.id
    });
    if (rpcError) console.error("Repoint failed", rpcError);

    return data;
}

export async function fetchLatestRates() {
    const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;

    const latest: Record<string, any> = {};
    (data || []).forEach(r => {
        if (!latest[r.currency_code]) {
            latest[r.currency_code] = r;
        }
    });
    return Object.values(latest);
}

// Recurring Rules

export async function fetchRecurringRules() {
    const { data, error } = await supabase
        .from('recurring_rules')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function insertRecurringRule(rule: Partial<RecurringRule>) {
    const { data, error } = await supabase
        .from('recurring_rules')
        .insert(rule)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateRecurringRule(id: string, updates: Partial<RecurringRule>) {
    const { data, error } = await supabase
        .from('recurring_rules')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteRecurringRule(id: string) {
    const { error } = await supabase
        .from('recurring_rules')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

export async function ensureRecurringGenerated(untilDate: string) {
    const { error } = await supabase.rpc('ensure_recurring_generated', { until_date: untilDate });
    if (error) throw error;
}

export async function computeMonthBalance(month: string) {
    // month YYYY-MM-01
    const { data, error } = await supabase.rpc('compute_month_balance', { target_month: month });
    if (error) throw error;
    return data as { income: number; expense: number; balance: number } || { income: 0, expense: 0, balance: 0 };
}
