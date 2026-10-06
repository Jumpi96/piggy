import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

interface CommitLedgerRequest {
    content: string;
    message: string;
    // SHA-256 (hex) of the ledger text the client edited. When present, the commit is
    // refused if the file changed since: the client sends the whole file, so committing
    // on top of a newer version silently erased whatever was added in between.
    baseHash?: string;
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64Utf8(b64: string): string {
    const binary = atob(b64.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

interface GitHubFileResponse {
    sha: string;
    content: string;
    encoding: string;
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

        const body: CommitLedgerRequest = await req.json();
        const { content, message, baseHash } = body;

        // Validate required fields
        if (content === undefined || !message) {
            return errorResponse('Missing required fields: content, message');
        }

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        // Step 1: Get current file SHA
        const getResponse = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Piggy-Savings-App',
            },
        });

        let sha: string | undefined;

        if (getResponse.ok) {
            const fileData: GitHubFileResponse = await getResponse.json();
            sha = fileData.sha;

            // GitHub inlines content for files up to 1 MB; beyond that it's empty and the
            // check is skipped (the sha below still guards the GET→PUT window).
            if (baseHash && fileData.encoding === 'base64' && fileData.content) {
                const currentHash = await sha256Hex(decodeBase64Utf8(fileData.content));
                if (currentHash !== baseHash) {
                    return errorResponse('The ledger changed since it was loaded. Reload the Savings page and redo your edit.', 409);
                }
            }
        } else if (getResponse.status !== 404) {
            // If not 404, it's an actual error
            const errorText = await getResponse.text();
            console.error('GitHub GET error:', getResponse.status, errorText);
            return errorResponse(`Failed to get file info: ${getResponse.status}`, getResponse.status);
        }
        // If 404, the file doesn't exist yet - we'll create it

        // Step 2: PUT the updated content
        const putBody: {
            message: string;
            content: string;
            sha?: string;
        } = {
            message,
            content: btoa(unescape(encodeURIComponent(content))), // Base64 encode UTF-8 content
        };

        if (sha) {
            putBody.sha = sha;
        }

        const putResponse = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Piggy-Savings-App',
            },
            body: JSON.stringify(putBody),
        });

        if (!putResponse.ok) {
            const errorText = await putResponse.text();
            console.error('GitHub PUT error:', putResponse.status, errorText);

            if (putResponse.status === 409) {
                return errorResponse('Conflict: file was modified. Please refresh and try again.', 409);
            }
            if (putResponse.status === 401) {
                return errorResponse('Invalid GitHub token or insufficient permissions.', 401);
            }
            if (putResponse.status === 422) {
                return errorResponse('Invalid request. Check your repository permissions.', 422);
            }

            return errorResponse(`GitHub API error: ${putResponse.status}`, putResponse.status);
        }

        return jsonResponse({ success: true });

    } catch (error) {
        console.error('Error in commit-ledger:', error);
        return errorResponse(
            error instanceof Error ? error.message : 'Unknown error',
            500
        );
    }
});
