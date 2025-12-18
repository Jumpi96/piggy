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

def import_toshl_csv(file_path, supabase_url, supabase_key, user_id, dry_run=False):
    print(f"Starting import from {file_path} for user {user_id}...")
    
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    
    cards = fetch_credit_cards(supabase_url, headers)
    rates = fetch_latest_exchange_rates(supabase_url, headers)
    
    transactions_to_insert = []
    
    with open(file_path, mode='r', encoding='utf-8-sig') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            # Toshl CSV columns: Date,Account,Category,Tags,Expense amount,Income amount,Currency,...
            date_str = row['Date'] # MM/DD/YY
            try:
                date_obj = datetime.strptime(date_str, '%m/%d/%y')
            except ValueError:
                # Try different format if needed, but example shows M/D/YY
                date_obj = datetime.strptime(date_str, '%m/%d/%Y')
                
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
                print(f"Skipping zero-amount transaction on {date_str}")
                continue
                
            tag_data = process_tags(row['Tags'])
            
            card_id = None
            if tag_data['payment_method'] == 'card':
                card_id = cards.get(tag_data['card_name'])
                if not card_id:
                    print(f"Warning: Credit card '{tag_data['card_name']}' not found in DB. Falling back to cash.")
                    tag_data['payment_method'] = 'cash'
            
            rate_info = rates.get(currency)
            rate_id = rate_info['id'] if rate_info else None
            
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
                "note": description if description else None,
                "recurring_rule_id": None
            }
            transactions_to_insert.append(tx)
            
    if dry_run:
        print(f"Dry run: Would insert {len(transactions_to_insert)} transactions.")
        for tx in transactions_to_insert[:5]:
            print(tx)
        if len(transactions_to_insert) > 5:
            print("...")
    else:
        print(f"Inserting {len(transactions_to_insert)} transactions...")
        url = f"{supabase_url}/rest/v1/transactions"
        response = requests.post(url, headers=headers, json=transactions_to_insert)
        if response.status_code == 201:
            print("Import successful!")
        else:
            print(f"Error inserting transactions: {response.status_code}")
            print(response.text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Import Toshl CSV into Piggy Supabase')
    parser.add_argument('file', help='Path to the Toshl CSV file')
    parser.add_argument('--url', required=True, help='Supabase project URL')
    parser.add_argument('--key', required=True, help='Supabase key (Service Role Key recommended)')
    parser.add_argument('--user-id', required=True, help='Your Supabase User ID (UUID)')
    parser.add_argument('--dry-run', action='store_true', help='Dry run (print data without inserting)')
    
    args = parser.parse_args()
    
    import_toshl_csv(args.file, args.url, args.key, args.user_id, args.dry_run)
