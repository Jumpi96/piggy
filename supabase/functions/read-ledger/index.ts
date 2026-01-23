import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

interface ReadLedgerRequest {
    // No longer needs fields from body
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) return corsResponse;

    try {
        const owner = Deno.env.get('LEDGER_GITHUB_OWNER');
        const repo = Deno.env.get('LEDGER_GITHUB_REPO');
        const path = Deno.env.get('LEDGER_GITHUB_PATH');
        const token = Deno.env.get('LEDGER_GITHUB_TOKEN');

        // Validate required environment variables
        if (!owner || !repo || !path || !token) {
            console.error('Missing environment variables: LEDGER_GITHUB_OWNER, LEDGER_GITHUB_REPO, LEDGER_GITHUB_PATH, LEDGER_GITHUB_TOKEN');
            return errorResponse('Server configuration error: missing GitHub credentials', 500);
        }

        // Fetch file content from GitHub API
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3.raw',
                'User-Agent': 'Piggy-Savings-App',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('GitHub API error:', response.status, errorText);

            if (response.status === 404) {
                return errorResponse('File not found. Check the repository and path.', 404);
            }
            if (response.status === 401) {
                return errorResponse('Invalid GitHub token or insufficient permissions.', 401);
            }

            return errorResponse(`GitHub API error: ${response.status}`, response.status);
        }

        const content = await response.text();

        return jsonResponse({ content });

    } catch (error) {
        console.error('Error in read-ledger:', error);
        return errorResponse(
            error instanceof Error ? error.message : 'Unknown error',
            500
        );
    }
});
