import { TransactionForm } from '../components/TransactionForm';

export function AddTransaction() {
    return (
        <div className="p-4 md:p-6 max-w-2xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-bold">Add Transaction</h1>
                <p className="text-gray-500 dark:text-gray-400">Record a new income or expense.</p>
            </header>

            <TransactionForm />
        </div>
    );
}
