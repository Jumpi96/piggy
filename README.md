# Piggy - Personal Finance Manager

A modern, mobile-first Progressive Web App (PWA) for personal finance management with multi-currency support, intelligent credit card tracking, and automated recurring transactions.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Database Schema](#database-schema)
- [Savings Feature](#savings-feature-ledger-integration)
- [License](#license)

## Features

- **Offline-First Architecture**: Full functionality without internet - data syncs when back online
- **Multi-Currency Support**: Track transactions in multiple currencies (USD, EUR, ARS, etc.) with monthly exchange rate management
- **Credit Card Intelligence**: Automatic "Effective Date" calculation based on credit card closing and payment days
- **Recurring Transactions**: Define rules for recurring income/expenses and automatically generate transactions up to 24 months ahead
- **To Be Balanced Flag**: Mark transactions for future reconciliation or shared expenses
- **Monthly Dashboard**: Real-time overview showing net balance, income, and expenses in USD
- **Smart Tag Autocomplete**: Frequency-based tag suggestions for faster transaction entry
- **Credit Card Reports**: View monthly credit card statements with proper date calculations
- **Progressive Web App (PWA)**: Install on any device, works offline like a native app
- **Mobile-First Design**: Optimized responsive UI for mobile devices
- **Secure Authentication**: Email/password and magic link authentication via Supabase
- **Automated Backups**: Weekly database backups to AWS S3 with 30-day retention
- **Background Sync**: Automatic data synchronization when online with conflict resolution
- **Savings & Investment Tracking**: Ledger-based savings tracking with GitHub integration, allocation metrics, and asset evolution charts

## Architecture

Piggy follows an **offline-first architecture** where all reads and writes go through a local SQLite database first, with background synchronization to the cloud:

```
┌─────────────────────────────────────────────────────────────┐
│                   Frontend (React PWA)                       │
│  - React 19 + TypeScript + Vite                             │
│  - Tailwind CSS                                              │
│  - Service Worker for offline caching                        │
│  - Deployed on GitHub Pages                                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              Local Database (PGlite/SQLite)                  │
│  - PostgreSQL-compatible WASM database                       │
│  - IndexedDB persistence (survives refresh)                  │
│  - All reads/writes happen here first                        │
│  - Pending changes queue for sync                            │
└──────────────┬──────────────────────────────────────────────┘
               │ Background Sync (when online)
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Supabase)                        │
│  - PostgreSQL database (source of truth)                     │
│  - Row Level Security (RLS)                                  │
│  - Authentication                                            │
│  - PL/pgSQL stored procedures                                │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              AWS Infrastructure (Terraform)                  │
│  - Lambda: Database backups (weekly)                         │
│  - Lambda: Recurring generator (monthly)                     │
│  - S3: Backup storage                                        │
│  - SNS: Failure alerts                                       │
│  - CloudWatch: Event scheduling                              │
└─────────────────────────────────────────────────────────────┘
```

### Offline-First Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User       │     │  Local DB    │     │   Supabase   │
│   Action     │────▶│  (PGlite)    │────▶│   (Cloud)    │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                     │
                            ▼                     │
                     ┌──────────────┐             │
                     │   Pending    │◀────────────┘
                     │   Changes    │   Pull changes
                     │   Queue      │   (incremental)
                     └──────────────┘
```

1. **Write**: User actions write to local SQLite immediately
2. **Queue**: Changes are queued in `_pending_changes` table
3. **Push**: Background sync pushes changes to Supabase
4. **Pull**: Incremental sync pulls server changes (last-write-wins)

### Key Components

**Frontend (`/src/`)**
- **Pages**: Overview dashboard, transaction list, balance view, credit reports, recurring rules, settings
- **Components**: Shared layout, transaction form, navigation, sync status indicator
- **Libraries**: API client (offline-first), date utilities, recurrence calculator
- **Offline Module** (`/src/lib/offline/`):
  - `database.ts` - PGlite initialization with IndexedDB persistence
  - `schema.ts` - Local schema mirroring Supabase
  - `sync/` - Push/pull synchronization with conflict resolution
  - `network.ts` - React hooks for online/offline status

**Backend (`/supabase/`)**
- **Tables**: transactions, credit_cards, currencies, exchange_rates, recurring_rules, parameters
- **RPCs**: `compute_month_balance()`, `get_sync_counts()`, `repoint_exchange_rate()`
- **Security**: Row Level Security policies ensuring users only access their own data

**Infrastructure (`/terraform/`)**
- **Lambda Functions**: Automated backup and recurring transaction generation
- **Storage**: S3 bucket with lifecycle policies
- **Monitoring**: CloudWatch alarms and SNS notifications

## Tech Stack

### Frontend
- **React** 19.2.0 - UI framework
- **TypeScript** 5.9 - Type safety
- **Vite** 7.2.4 - Build tool and dev server
- **React Router** 7.10.1 - Client-side routing
- **Tailwind CSS** 4.1.18 - Utility-first styling
- **Lucide React** 0.561.0 - Icon library
- **Vite PWA** 1.2.0 - Progressive Web App support

### Local Database (Offline-First)
- **PGlite** 0.3.14 - PostgreSQL compiled to WebAssembly
- **IndexedDB** - Browser-based persistent storage
- **Custom Sync Layer** - Push/pull with last-write-wins conflict resolution

### Backend & Database
- **Supabase** 2.88.0 - Backend-as-a-Service
- **PostgreSQL** - Relational database (cloud source of truth)
- **PL/pgSQL** - Server-side business logic

### Infrastructure & DevOps
- **AWS Lambda** - Serverless functions (Python 3.11)
- **AWS S3** - Backup storage
- **AWS CloudWatch** - Event scheduling
- **AWS SNS** - Alert notifications
- **Terraform** 1.6.0 - Infrastructure as Code
- **GitHub Actions** - CI/CD pipeline

### Development Tools
- **ESLint** 9.39.1 - Code linting
- **Vitest** 3.2.4 - Unit testing
- **TypeScript** - Static type checking

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ and npm
- **Git** for version control
- **Supabase Account** - [Sign up here](https://supabase.com/)
- **AWS Account** (optional, for backups and recurring transactions)
- **Terraform** 1.6.0+ (optional, for AWS infrastructure)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/piggy.git
cd piggy
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com/)
2. Go to Project Settings > API to find your project URL and anon key
3. In the SQL Editor, run the following scripts in order:
   - `supabase/schema.sql` - Creates tables and RLS policies
   - `supabase/rpcs.sql` - Creates stored procedures

### 4. Configure Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 5. Run the Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` to see the app running.

### 6. Set Up AWS Infrastructure (Optional)

The AWS infrastructure provides automated database backups and recurring transaction generation.

#### Prerequisites
- AWS account with appropriate permissions
- AWS CLI configured with credentials
- Terraform installed

#### Setup Steps

1. Navigate to the terraform directory:
```bash
cd terraform
```

2. Create a `terraform.tfvars` file:
```hcl
supabase_db_url = "postgresql://user:password@host:port/database"
alert_email     = "your-email@example.com"
```

3. Initialize and apply Terraform:
```bash
terraform init
terraform plan
terraform apply
```

This will create:
- Lambda function for weekly database backups (runs Sundays at 2 AM UTC)
- Lambda function for monthly recurring transaction generation (runs on the 1st at 1 AM UTC)
- S3 bucket for backups with 30-day retention
- CloudWatch Event Rules for scheduling
- SNS topic for failure alerts

## Development

### Project Structure

```
piggy/
├── src/
│   ├── components/        # Reusable UI components
│   ├── pages/            # Page-level components
│   ├── lib/
│   │   ├── api.ts        # Offline-first API client
│   │   ├── offline/      # Offline module
│   │   │   ├── database.ts   # PGlite initialization
│   │   │   ├── schema.ts     # Local schema
│   │   │   ├── network.ts    # Online/offline hooks
│   │   │   └── sync/         # Sync layer
│   │   │       ├── pull.ts   # Pull from server
│   │   │       ├── push.ts   # Push to server
│   │   │       ├── queue.ts  # Pending changes queue
│   │   │       └── conflict.ts # Conflict resolution
│   │   └── ...           # Other utilities
│   └── types/            # TypeScript type definitions
├── supabase/
│   ├── schema.sql        # Database schema and RLS policies
│   ├── rpcs.sql          # Stored procedures
│   └── migrations/       # Database migrations
├── terraform/
│   ├── *.tf              # Infrastructure definitions
│   └── lambdas/          # Lambda function code
└── .github/workflows/    # CI/CD pipelines
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run test         # Run unit tests
npm run lint         # Run ESLint
```

### Code Style

- TypeScript strict mode enabled
- ESLint for code quality
- Consistent file naming (PascalCase for components, camelCase for utilities)
- Tailwind CSS for styling

## Testing

Run the test suite:

```bash
npm test
```

Tests are written using Vitest and cover:
- Date utilities and credit card effective date calculations
- Recurrence logic for generating future transactions
- Component behavior and rendering

## Deployment

### GitHub Pages (Automated)

The project uses GitHub Actions for automatic deployment to GitHub Pages on releases.

#### Setup

1. **Enable GitHub Pages**:
   - Go to Settings > Pages
   - Set Source to "GitHub Actions"

2. **Configure Repository Secrets**:
   - `VITE_SUPABASE_URL` - Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
   - `AWS_ACCESS_KEY_ID` - AWS credentials (for Terraform)
   - `AWS_SECRET_ACCESS_KEY` - AWS credentials (for Terraform)
   - `SUPABASE_DB_URL` - Database connection string
   - `ALERT_EMAIL` - Email for Lambda failure alerts

3. **Create a Release**:
   - GitHub Actions will automatically build and deploy

The deployment workflow:
1. Builds the React app with Vite
2. Deploys to GitHub Pages
3. Applies Terraform changes to AWS infrastructure

### Manual Deployment

To build and deploy manually:

```bash
# Build the app
npm run build

# The dist/ folder contains the static files
# Deploy to any static hosting service (Netlify, Vercel, etc.)
```

## Database Schema

### Core Tables (Supabase + Local)

- **transactions**: Main ledger for all financial transactions
  - Supports multiple currencies
  - Links to credit cards for effective date calculation
  - Includes "to be balanced" flag for reconciliation

- **credit_cards**: Credit card configurations
  - Closing day and payment day for statement cycles
  - Used to calculate transaction effective dates

- **currencies**: Supported currency definitions (USD, EUR, ARS, etc.)

- **exchange_rates**: Monthly exchange rates for currency conversion
  - Base currency: USD
  - One rate per currency per month

- **recurring_rules**: Definitions for recurring transactions
  - Frequency (daily, weekly, monthly, yearly)
  - Amount, category, payment method
  - Auto-generates transactions via Lambda

- **parameters**: User-specific settings and preferences

### Local-Only Tables (Sync Metadata)

- **_sync_meta**: Key-value store for sync state
  - `last_sync_at` - Timestamp of last successful sync
  - `user_id` - Current authenticated user
  - `schema_version` - For local schema migrations

- **_pending_changes**: Queue of unsynced local changes
  - `table_name`, `record_id`, `operation` (INSERT/UPDATE/DELETE)
  - `payload` - JSON of the change
  - `synced_at` - Null until successfully pushed

### Key Database Functions (RPCs)

- `compute_month_balance(year, month, user_id)`: Calculates monthly income, expenses, and net balance in USD
- `repoint_exchange_rate(year, month, currency, user_id)`: Updates exchange rate references for a month

> Recurring transactions are generated client-side as virtual occurrences
> (`src/lib/recurringUtils.ts`); there is no `ensure_recurring_generated` RPC.

## Savings Feature (Ledger Integration)

The Savings page provides investment and savings tracking using a plain-text ledger file stored in a private GitHub repository. It replicates the functionality of the Streamlit grootboek tool.

### Features

- **Overview Tab**: KPIs (total assets, retirement, liabilities, net worth), savings goals progress, investment allocation metrics, pie charts
- **Add Transaction Tab**: Create new ledger entries with real-time balance validation
- **Raw Data Tab**: View all account balances in flat table or hierarchical tree format
- **Assets Evolution Tab**: Time series charts showing asset growth and deposits vs appreciation

### Setup Instructions

#### 1. Create a GitHub Repository for Your Ledger

1. Create a new **private** repository on GitHub (e.g., `my-ledger`)
2. Add a ledger file (e.g., `ledger/main.journal`) with initial content:

```
; My Ledger File
; Prices go here
P 2024/01/01 SPY $ 475.00
P 2024/01/01 BTC $ 42000.00

; Opening balances
2024/01/01 Opening Balance
  Assets:Bank:Checking  $10000.00
  Equity:Opening

; Example transaction
2024/01/15 Buy ETF
  Assets:Investments:SPY  10 SPY
  Assets:Bank:Checking  $-4750.00
```

#### 2. Create a GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Piggy Ledger Access")
4. Select the `repo` scope (full control of private repositories)
5. Click "Generate token"
6. **Copy the token immediately** - you won't see it again!

#### 3. Deploy Supabase Edge Functions

The Savings feature requires two Supabase Edge Functions to interact with GitHub:

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project (get project ref from Supabase dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the edge functions
supabase functions deploy read-ledger
supabase functions deploy commit-ledger
```

**Verify deployment:**
```bash
# List deployed functions
supabase functions list
```

You should see `read-ledger` and `commit-ledger` in the list.

#### 4. Configure Supabase Secrets

The GitHub connection details are stored securely as environment variables in Supabase. Use the Supabase CLI to set them:

```bash
# Set GitHub repository connection details
supabase secrets set LEDGER_GITHUB_OWNER=your_github_username
supabase secrets set LEDGER_GITHUB_REPO=your_ledger_repo_name
supabase secrets set LEDGER_GITHUB_PATH=path/to/ledger/main.journal
supabase secrets set LEDGER_GITHUB_TOKEN=your_github_pat_token
```

#### 5. Verify and Polish

1. Open Piggy and go to **Settings → Ledger** tab
2. Click **"Check Connection Status"** to verify the app can communicate with GitHub using the configured secrets.
3. (Optional) Customize the **Allocation Configuration** JSON to match your investment strategy.

#### 6. Test the Feature

1. Navigate to the **Savings** page from the sidebar
2. Verify the **Overview** tab shows your account balances and KPIs
3. Try adding a transaction in the **Add** tab:
   - Select a date
   - Enter a description
   - Add at least 2 postings (e.g., `Assets:Bank:Checking` with `$-100` and `Expenses:Food` with `$100`)
   - Wait for the "Transaction is balanced" indicator
   - Click "Add Transaction"
4. Check your GitHub repo to confirm the transaction was committed
5. View balances in the **Raw Data** tab
6. Explore asset evolution in the **Evolution** tab

### Ledger File Format

The parser supports standard ledger format:

```
; Comments start with semicolon

; Price directives (for USD conversion)
P 2024/01/15 BTC $ 42000.00
P 2024/01/15 ETH $ 2500.00

; Transactions
2024/01/15 Transaction description
  Account:SubAccount:Name  $100.00
  Account:Another:Name  $-100.00

; Amount formats supported:
;   $100.00 or -$100.00 (USD)
;   100 USD (currency code)
;   0.5 BTC (cryptocurrency)
;   10 SPY (stock shares)
;   (empty) - auto-balance the transaction
```

### Allocation Configuration

The allocation config (editable in Settings → Ledger) defines:

- **Expected allocation percentages** for investment categories
- **Account patterns** (regex) to match accounts to categories
- **Savings goals** with target amounts

Example configuration:
```json
{
  "expected": 0.89,
  "categories": {
    "main_stocks": {
      "expected": 0.73,
      "patterns": ["Assets:3_Retirement:.*:SPY", "Assets:3_Retirement:.*:VEA"]
    },
    "crypto": {
      "expected": 0.05,
      "patterns": ["Assets:3_Retirement:.*:BTC", "Assets:3_Retirement:.*:ETH"]
    }
  },
  "goals": {
    "security": { "target": 12000, "pattern": "Assets:1_Security" },
    "discretionary": { "target": 8000, "pattern": "Assets:0_Discretionary" }
  },
  "liabilities_pattern": "Liabilities"
}
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Ledger not configured" | Go to Settings → Ledger and configure GitHub connection |
| "Failed to read ledger" | Check GitHub token has `repo` scope and hasn't expired |
| "File not found" | Verify the file path is correct (case-sensitive) |
| Edge function errors | Ensure functions are deployed: `supabase functions list` |
| Transaction not balanced | Each commodity must sum to zero across all postings |

## License

MIT License - feel free to use this project for personal or commercial purposes.

---

**Note**: This is a personal finance management tool. Always ensure you keep backups of your financial data and secure your Supabase credentials.
