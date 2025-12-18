import csv
import os
import requests
import argparse
from datetime import datetime
from decimal import Decimal

def fetch_credit_cards(supabase_url, headers):
    url = f"{supabase_url}/rest/v1/credit_cards?select=id,name"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return {card['name']: card['id'] for card in response.json()}

def fetch_latest_exchange_rates(supabase_url, headers):
    # Fetch all exchange rates ordered by created_at desc
    url = f"{supabase_url}/rest/v1/exchange_rates?select=currency_code,id,rate&order=created_at.desc"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    latest_rates = {}
    for rate in response.json():
        if rate['currency_code'] not in latest_rates:
            latest_rates[rate['currency_code']] = rate
    return latest_rates

def process_tags(tags_str):
    if not tags_str:
        return {
            "tag": "untagged",
            "to_be_balanced": False,
            "payment_method": "cash",
            "card_name": None
        }
    
    # Split tags and strip whitespace
    tags = [t.strip() for t in tags_str.split(',')]
    
    to_be_balanced = False
    payment_method = "cash"
    card_name = None
    
    final_tags = []
    
    original_tags = list(tags)
    
    for t in tags:
        t_lower = t.lower()
        if t_lower == 'balance':
            to_be_balanced = True
        elif t_lower == 'placeholder':
            continue
        elif t_lower == 'creditnl':
            payment_method = "card"
            card_name = "ABN AMRO NL"
        elif t_lower == 'credit':
            payment_method = "card"
            card_name = "VISA Adicional"
        else:
            final_tags.append(t)
            
    # Logic for final tag
    if final_tags:
        tag = final_tags[0]
    else:
        # Fallback cases when only special tags were present
        if any(t.lower() in ['credit', 'creditnl'] for t in original_tags):
            tag = "credit"
        elif to_be_balanced:
            tag = "to be balanced"
        else:
            tag = "imported" # Should not happen based on rules
            
    return {
        "tag": tag,
        "to_be_balanced": to_be_balanced,
        "payment_method": payment_method,
        "card_name": card_name
    }

def create_exchange_rate(supabase_url, headers, currency_code, rate, user_id):
    url = f"{supabase_url}/rest/v1/exchange_rates"
    payload = {
        "currency_code": currency_code,
        "rate": float(rate),
        "user_id": user_id
    }
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    # Return the first (and only) returned item
    return response.json()[0]['id']

def import_toshl_csv(file_path, supabase_url, supabase_key, user_id, dry_run=False):
    print(f"Starting historical import from {file_path} for user {user_id}...")
    
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    
    # 1. Capture initial latest rates
    print("Capturing initial exchange rates...")
    initial_rates = fetch_latest_exchange_rates(supabase_url, headers)
    cards = fetch_credit_cards(supabase_url, headers)
    
    # 2. Read all data
    all_rows = []
    with open(file_path, mode='r', encoding='utf-8-sig') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            all_rows.append(row)
            
    # Parse dates and group by month
    by_month = {}
    for row in all_rows:
        date_str = row['Date'] # MM/DD/YY
        try:
            date_obj = datetime.strptime(date_str, '%m/%d/%y')
        except ValueError:
            date_obj = datetime.strptime(date_str, '%m/%d/%Y')
        
        row['_date_obj'] = date_obj
        month_key = date_obj.strftime('%Y-%m')
        if month_key not in by_month:
            by_month[month_key] = []
        by_month[month_key].append(row)
        
    sorted_months = sorted(by_month.keys())
    
    for month in sorted_months:
        print(f"\nProcessing month: {month}")
        month_rows = by_month[month]
        
        # 3. Calculate avg exchange rates for EUR and ARS
        rates_to_calc = ['EUR', 'ARS']
        month_rates = {}
        
        for cur in rates_to_calc:
            cur_rates = []
            for row in month_rows:
                if row['Currency'] == cur:
                    expense = Decimal(row['Expense amount'].replace(',', ''))
                    income = Decimal(row['Income amount'].replace(',', ''))
                    main_amount = Decimal(row['In main currency'].replace(',', ''))
                    total_cur = expense + income
                    if total_cur > 0 and main_amount > 0:
                        cur_rates.append(total_cur / main_amount)
            
            if cur_rates:
                avg_rate = sum(cur_rates) / len(cur_rates)
                print(f"  Calculated average rate for {cur}: {avg_rate}")
                if not dry_run:
                    rate_id = create_exchange_rate(supabase_url, headers, cur, avg_rate, user_id)
                    month_rates[cur] = rate_id
                else:
                    month_rates[cur] = f"DRY_RUN_{cur}_{month}"
        
        # Also need USD rate id (usually 1, but let's be safe and fetch it or use initial if it's USD)
        # Assuming main currency is USD, rate is 1.0
        # Check if USD rate exists in initial_rates or create it if missing for this user
        usd_rate_id = None
        if 'USD' in initial_rates:
            usd_rate_id = initial_rates['USD']['id']
            month_rates['USD'] = usd_rate_id
        
        # 4. Process transactions for this month
        transactions_to_insert = []
        for row in month_rows:
            date_obj = row['_date_obj']
            formatted_date = date_obj.strftime('%Y-%m-%d')
            
            expense = Decimal(row['Expense amount'].replace(',', ''))
            income = Decimal(row['Income amount'].replace(',', ''))
            currency = row['Currency']
            category = row['Category']
            description = row['Description']
            
            if expense > 0:
                amount_cents = int(expense * 100)
                direction = 'expense'
            elif income > 0:
                amount_cents = int(income * 100)
                direction = 'income'
            else:
                continue
                
            tag_data = process_tags(row['Tags'])
            
            card_id = None
            if tag_data['payment_method'] == 'card':
                card_id = cards.get(tag_data['card_name'])
                if not card_id:
                    print(f"    Warning: Credit card '{tag_data['card_name']}' not found.")
                    tag_data['payment_method'] = 'cash'
            
            # Use month-specific rate if available, otherwise fallback to global latest
            rate_id = month_rates.get(currency)
            if not rate_id and currency in initial_rates:
                rate_id = initial_rates[currency]['id']
            
            tx = {
                "user_id": user_id,
                "date": formatted_date,
                "direction": direction,
                "amount_cents": amount_cents,
                "currency_code": currency,
                "category": category,
                "tag": tag_data['tag'],
                "payment_method": tag_data['payment_method'],
                "credit_card_id": card_id,
                "exchange_rate_id": rate_id,
                "to_be_balanced": tag_data['to_be_balanced'],
                "note": description if description else None
            }
            transactions_to_insert.append(tx)
            
        if dry_run:
            print(f"  Dry run: Would insert {len(transactions_to_insert)} transactions for {month}.")
        else:
            print(f"  Inserting {len(transactions_to_insert)} transactions for {month}...")
            url = f"{supabase_url}/rest/v1/transactions"
            response = requests.post(url, headers=headers, json=transactions_to_insert)
            if response.status_code != 201:
                print(f"    Error inserting transactions: {response.status_code}")
                print(response.text)
                
    # 5. Restore initial exchange rates at the end
    print("\nRestoring initial exchange rates...")
    if not dry_run:
        for cur, rate_info in initial_rates.items():
            create_exchange_rate(supabase_url, headers, cur, rate_info['rate'], user_id)
        print("Restoration complete.")
    else:
        print("Dry run: Would restore original rates.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Import historical Toshl CSV into Piggy Supabase')
    parser.add_argument('file', help='Path to the Toshl CSV file')
    parser.add_argument('--url', required=True, help='Supabase project URL')
    parser.add_argument('--key', required=True, help='Supabase key (Service Role Key recommended)')
    parser.add_argument('--user-id', required=True, help='Your Supabase User ID (UUID)')
    parser.add_argument('--dry-run', action='store_true', help='Dry run (print data without inserting)')
    
    args = parser.parse_args()
    
    import_toshl_csv(args.file, args.url, args.key, args.user_id, args.dry_run)
