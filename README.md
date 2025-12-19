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
- [License](#license)

## Features

- **Multi-Currency Support**: Track transactions in multiple currencies (USD, EUR, ARS, etc.) with monthly exchange rate management
- **Credit Card Intelligence**: Automatic "Effective Date" calculation based on credit card closing and payment days
- **Recurring Transactions**: Define rules for recurring income/expenses and automatically generate transactions up to 24 months ahead
- **To Be Balanced Flag**: Mark transactions for future reconciliation or shared expenses
- **Monthly Dashboard**: Real-time overview showing net balance, income, and expenses in USD
- **Smart Tag Autocomplete**: Frequency-based tag suggestions for faster transaction entry
- **Credit Card Reports**: View monthly credit card statements with proper date calculations
- **Mobile-First Design**: Optimized responsive UI for mobile devices
- **Secure Authentication**: Email/password and magic link authentication via Supabase
- **Automated Backups**: Weekly database backups to AWS S3 with 30-day retention
- **Real-time Sync**: Instant data synchronization across devices

## Architecture

Piggy follows a three-tier architecture:

```
┌─────────────────────────────────────────┐
│         Frontend (React SPA)            │
│  - React 19 + TypeScript                │
│  - Vite build tool                      │
│  - Tailwind CSS                         │
│  - Deployed on GitHub Pages             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Backend (Supabase)                 │
│  - PostgreSQL database                  │
│  - Row Level Security (RLS)             │
│  - Authentication                       │
│  - Real-time subscriptions              │
│  - PL/pgSQL stored procedures           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   AWS Infrastructure (Terraform)        │
│  - Lambda: Database backups (weekly)    │
│  - Lambda: Recurring generator (monthly)│
│  - S3: Backup storage                   │
│  - SNS: Failure alerts                  │
│  - CloudWatch: Event scheduling         │
└─────────────────────────────────────────┘
```

### Key Components

**Frontend (`/src/`)**
- **Pages**: Overview dashboard, transaction list, balance view, credit reports, recurring rules, settings
- **Components**: Shared layout, transaction form, navigation
- **Libraries**: API client, date utilities, recurrence calculator

**Backend (`/supabase/`)**
- **Tables**: transactions, credit_cards, currencies, exchange_rates, recurring_rules, parameters
- **RPCs**: `compute_month_balance()`, `ensure_recurring_generated()`, `repoint_exchange_rate()`
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

### Backend & Database
- **Supabase** 2.88.0 - Backend-as-a-Service
- **PostgreSQL** - Relational database
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
│   ├── lib/              # Utilities and API clients
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

### Core Tables

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

### Key Database Functions (RPCs)

- `compute_month_balance(year, month, user_id)`: Calculates monthly income, expenses, and net balance in USD
- `ensure_recurring_generated(user_id)`: Generates recurring transactions up to 24 months ahead (idempotent)
- `repoint_exchange_rate(year, month, currency, user_id)`: Updates exchange rate references for a month

## License

MIT License - feel free to use this project for personal or commercial purposes.

---

**Note**: This is a personal finance management tool. Always ensure you keep backups of your financial data and secure your Supabase credentials.
