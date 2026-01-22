# Piggy - Personal Finance Manager

## Quick Reference

### Common Commands
```bash
npm run dev          # Start development server (localhost:5173)
npm run build        # Build for production (runs tsc then vite build)
npm run lint         # Run ESLint
npm run test         # Run Vitest unit tests
npm run preview      # Preview production build locally
```

### Key Directories
- `src/pages/` - Page-level React components
- `src/components/` - Reusable UI components
- `src/lib/` - Core utilities and business logic
- `src/lib/offline/` - Offline-first database and sync layer
- `src/types/` - TypeScript type definitions
- `supabase/` - Database schema, migrations, and RPCs
- `terraform/` - AWS infrastructure (Lambda, S3, CloudWatch)

## Architecture Overview

**Offline-First PWA**: All reads/writes go through local PGlite (SQLite/WASM) first, with background sync to Supabase. This is critical to understand - never bypass the local database.

```
User Action → Local PGlite → Pending Queue → Background Sync → Supabase
```

### Core Data Flow
1. All CRUD operations use functions in `src/lib/api.ts`
2. API functions write to local PGlite via `getDatabaseAsync()`
3. Changes are tracked in `_pending_changes` table via `trackChange()`
4. `triggerBackgroundSync()` pushes changes to Supabase when online

## Code Style Guidelines

### TypeScript
- **Strict mode enabled** - all types must be explicit
- Use ES modules (`import/export`), never CommonJS (`require`)
- Destructure imports: `import { getDatabaseAsync } from './offline/database'`
- Define types in `src/types/index.ts` for shared domain types
- Use `type` for simple type aliases, `interface` for object shapes

### React Components
- Use functional components with hooks only
- PascalCase for component files: `TransactionForm.tsx`
- camelCase for utility files: `recurringUtils.ts`
- Co-locate component-specific styles with Tailwind CSS
- Use `cn()` helper from `src/lib/utils.ts` for conditional classnames

### Styling
- Tailwind CSS 4.x for all styling
- Use Tailwind's design tokens, avoid arbitrary values when possible
- Mobile-first responsive design (app is PWA optimized for phones)

### Database & Types
- IDs are UUIDs generated with `crypto.randomUUID()`
- Dates stored as `YYYY-MM-DD` strings (not Date objects)
- Money stored in cents (`amount_cents: number`) to avoid float issues
- All tables have `user_id`, `created_at`, and soft-delete `deleted_at`

## Testing

```bash
npm test                      # Run all tests
npm test -- --watch           # Watch mode
npm test -- path/to/file      # Run specific test file
```

- Tests use **Vitest** with jsdom environment
- Test files are co-located: `api.test.ts` next to `api.ts`
- Setup file: `src/test/setup.ts`
- IMPORTANT: Prefer running single test files, not the whole suite

## Important Patterns

### Offline-First API Pattern
When adding new API functions in `src/lib/api.ts`:
```typescript
export async function myNewFunction() {
  const db = await getDatabaseAsync();
  const userId = await getUserId();
  
  // Perform local operation
  const result = await db.query(`...`, [userId]);
  
  // Track change for sync (for mutations)
  await trackChange('table_name', recordId, 'INSERT' | 'UPDATE' | 'DELETE', payload);
  
  // Trigger background sync
  triggerBackgroundSync('table_name');
  
  return result;
}
```

### Virtual Transactions
Recurring rules generate "virtual" transactions with composite IDs (`rule_id:date`). These are NOT persisted until edited. When editing a virtual transaction, create a physical "override" record with a new UUID.

### Date Handling
- Use `formatLocalDate()` and `getTodayLocalDate()` from `src/lib/dates.ts`
- Credit cards have `closing_day` and `payment_day` for effective date calculation
- Effective dates determine which month a credit card transaction appears in

## Common Pitfalls

1. **Never make direct Supabase calls** - Always go through the offline layer via `src/lib/api.ts`
2. **Don't forget `trackChange()`** - Mutations won't sync without it
3. **Virtual transaction IDs are not UUIDs** - They use `rule_id:YYYY-MM-DD` format, handle them specially
4. **Run typecheck after changes** - `npm run build` includes TypeScript compilation

## Database

### Local (PGlite)
Schema defined in `src/lib/offline/schema.ts` - mirrors Supabase tables plus sync metadata:
- `_sync_meta` - Key-value store for sync state
- `_pending_changes` - Queue of unsynced changes

### Remote (Supabase)
- Schema: `supabase/schema.sql`
- RPCs: `supabase/rpcs.sql`
- Migrations: `supabase/migrations/`

Key RPCs:
- `compute_month_balance()` - Monthly income/expense totals in USD
- `ensure_recurring_generated()` - Generate recurring transactions

## Deployment

- **Frontend**: GitHub Pages (via `.github/workflows/deploy.yml`)
- **Backend**: Supabase (PostgreSQL + Auth)
- **Infrastructure**: AWS Lambda for backups and recurring generation

Base URL: `/piggy/` (configured in `vite.config.ts`)

## Environment Variables
```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```
