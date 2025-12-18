# 🐽 piggy - Personal Finance PWA

piggy is a modern, mobile-first Personal Finance Progressive Web App (PWA) designed to track expenses, income, and manage multi-currency finances with ease. It features intelligent credit card date handling, monthly exchange rate balancing, and a sleek, responsive UI.

## ✨ Features

- **📱 Mobile-First Design**: Optimized for touch interactions and mobile viewports.
- **💸 Multi-Currency Support**: Track transactions in any currency (USD, EUR, ARS, etc.).
- **💱 Exchange Rate Balancing**: Define monthly exchange rates to unify your monthly balance in USD.
- **💳 Credit Card Management**: Automatically calculates "Effective Dates" for credit card purchases based on closing and payment days.
- **⚖️ "To Be Balanced" Flag**: Mark transactions that need attention or future reconciliation (e.g., shared expenses).
- **🏷️ Tag Autocomplete**: Smart tagging system with frequency-based autocomplete.
- **📊 Monthly Overview**: Real-time dashboard showing Net Balance, Income, and Expenses.
- **🔐 Secure**: Built on Supabase with Row Level Security (RLS) ensuring your data is private.

## 🛠️ Tech Stack

- **Frontend**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Lucide Icons](https://lucide.dev/)
- **Backend / DB**: [Supabase](https://supabase.com/) (PostgreSQL, Auth, Realtime)
- **Deployment**: Vercel / Netlify (SPA capabilities)

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- A [Supabase](https://supabase.com/) project.

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/piggy.git
cd piggy
npm install
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Database Setup (Supabase)

1.  Go to your Supabase Project Dashboard -> SQL Editor.
2.  Open `supabase/schema.sql` from this repository and run it to create tables and policies.
3.  Open `supabase/rpcs.sql` and run it to create necessary Database Functions (RPCs).

> **Note**: RLS policies are enabled by default. Users can only see their own data.

### 4. Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

## 📦 Deployment

### Vercel / Netlify

1.  Connect your repository.
2.  Set the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables in the dashboard.
3.  Deploy! using the default settings (`npm run build`, output directory `dist`).

### GitHub Actions (Automated Deployment to GitHub Pages)

This repository includes a GitHub Action to automatically deploy to GitHub Pages.

#### Kickstart Instructions:

1.  **Push Code**: Push this code to a GitHub repository.
2.  **Enable Pages**:
    -   Go to Repository Settings -> **Pages**.
    -   Under "Build and deployment", select **Source** as **GitHub Actions**.
3.  **Configure URL**:
    -   If your repo is at `https://github.com/username/piggy`, you usually need to set the base path in `vite.config.ts`.
    -   Open `vite.config.ts` and set `base: '/piggy/'`.
    -   Push the change.
4.  **Run**: The action will run automatically on push to `main`.
5.  **Environment Variables**:
    -   GitHub Pages is static. To inject environment variables (like Supabase URL), you must define them in the Repository **Secrets** (Settings -> Secrets and variables -> Actions).
    -   Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
    -   **Important**: Updates to the workflow yaml are needed to pass these secrets to the build step:
        ```yaml
        - name: Build
          run: npm run build
          env:
            VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
            VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
        ```

## 🗄️ Database Schema

- `transactions`: Core ledger.
- `credit_cards`: Stores closing/payment day logic.
- `currencies`: List of supported currencies.
- `exchange_rates`: Monthly rates for currency conversion (Base: USD).
- `recurring_rules`: (Planned) Logic for recurring payments.

## 🤝 Contributing

1.  Fork the repo.
2.  Create a feature branch.
3.  Submit a Pull Request.

## 📄 License

MIT
