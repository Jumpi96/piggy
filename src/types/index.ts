export type Direction = 'income' | 'expense';
export type PaymentMethod = 'cash' | 'card';
export type ScheduleType = 'monthly_day' | 'every_n_days' | 'every_n_months';

export interface Currency {
    code: string;
    name: string;
}

export interface ExchangeRate {
    id: string;
    user_id: string;
    currency_code: string;
    rate: number;
    created_at: string;
}

export interface CreditCard {
    id: string;
    user_id: string;
    name: string;
    closing_day: number;
    payment_day: number;
    created_at: string;
    deleted_at?: string | null;
}

export interface RecurringRule {
    id: string;
    user_id: string;
    direction: Direction;
    amount_cents: number;
    currency_code: string;
    category: string;
    tag: string;
    payment_method: PaymentMethod;
    credit_card_id?: string | null;
    schedule_type: ScheduleType;
    schedule_config: Record<string, any>; // JSON
    start_date: string; // YYYY-MM-DD
    end_date?: string | null;
    active: boolean;
    note?: string | null;
    created_at: string;
    deleted_at?: string | null;
}

export interface Transaction {
    id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    direction: Direction;
    amount_cents: number;
    currency_code: string;
    exchange_rate_id?: string | null;
    exchange_rate?: { rate: number } | null;
    category: string;
    tag: string;
    payment_method: PaymentMethod;
    credit_card_id?: string | null;
    credit_card?: { name: string } | null;
    recurring_rule_id?: string | null;
    to_be_balanced: boolean;
    note?: string | null;
    created_at: string;
    updated_at: string;
    deleted_at?: string | null;
}

export interface Parameter {
    id: string;
    user_id: string;
    key: string;
    value: any;
    updated_at: string;
}
