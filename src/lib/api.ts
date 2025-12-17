import { supabase } from './supabase';
import type { Currency, CreditCard, Transaction } from '../types';

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

export async function fetchTransactions(monthStart: string): Promise<Transaction[]> {
    // monthStart should be YYYY-MM-01
    // Filter by date range? Or just by month?
    // Spec says "Monthly ledger".
    // We can filter by date >= monthStart AND date < monthStart + 1 month

    // Easier: client-side filter or exact match on month part?
    // Let's do simple range query.

    const start = new Date(monthStart);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const { data, error } = await supabase
        .from('transactions')
        .select('*, exchange_rate:exchange_rates(rate)')
        .gte('date', start.toISOString().split('T')[0])
        .lt('date', end.toISOString().split('T')[0])
        .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
}

export async function fetchExchangeRate(currencyCode: string, date: string): Promise<string | null> {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dateStr = `${year}-${month}-01`;

    const { data, error } = await supabase
        .from('exchange_rates')
        .select('id')
        .eq('currency_code', currencyCode)
        .eq('month', dateStr)
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

export async function upsertExchangeRate(currencyCode: string, month: string, rate: number) {
    // month is YYYY-MM-01
    // We need to find if exists, or insert.
    // Supabase upsert requires unique constraint.
    // composite key (user_id, currency_code, month) should be unique.

    // Check if rate exists first to get ID? Or just upsert?
    // If we upsert, we need existing ID if we want to keep history?
    // Actually exchange_rates has ID.
    // Query by unique keys.
    const { data: existing } = await supabase
        .from('exchange_rates')
        .select('id')
        .eq('currency_code', currencyCode)
        .eq('month', month)
        .maybeSingle();

    if (existing) {
        const { data, error } = await supabase
            .from('exchange_rates')
            .update({ rate })
            .eq('id', existing.id)
            .select()
            .single();
        if (error) throw error;
        return data;
    } else {
        const { data, error } = await supabase
            .from('exchange_rates')
            .insert({ currency_code: currencyCode, month, rate })
            .select()
            .single();
        if (error) throw error;
        return data;
    }
}

export async function fetchRatesForMonth(month: string) {
    const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .eq('month', month);
    if (error) throw error;
    return data || [];
}
