// BreedIQ — remote MCP server (Streamable HTTP, stateless)
//
// POST /api/mcp/:token
//
// Lets any MCP client — a claude.ai custom connector, Claude Code
// (`claude mcp add --transport http breediq <url>`), or anything else that
// speaks the protocol — read and write the breeder's program directly:
// "Rainey had 8 puppies this morning" → update_litter → live on the site.
//
// Design decisions, so future edits don't undo them:
//
// 1. ONE tool layer. The tools exposed here are lib/assistant/tools.js —
//    the exact schemas and executors behind the in-app Ask BreedIQ
//    assistant. No parallel implementations to drift apart; a tool added
//    there shows up here automatically.
//
// 2. No destructive tools. delete_dog / delete_litter / delete_guardian
//    are excluded from the listing entirely. Their confirmation flow is a
//    UI signal an MCP client can't send, so exposing them would only offer
//    a button that never fires. Deletions happen in the app.
//
// 3. Auth is a per-profile bearer token in the URL path — the same pattern
//    as the ICS calendar feed (profiles.calendar_feed_token). Stored on
//    profiles.mcp_token, unguessable (32 random bytes), rotatable by
//    overwriting the column. NULL = MCP disabled for that account.
//    Trade-off, stated plainly: a URL-borne credential can end up in
//    request logs. Acceptable for v1 for the same reasons as the calendar
//    feed; the upgrade path is OAuth when BreedIQ has more MCP users.
//
// 4. Stateless transport. Every POST builds a fresh Server + transport and
//    tears them down; no session state survives between requests, which is
//    exactly what a serverless function wants. GET (SSE resume) and DELETE
//    (session teardown) have nothing to attach to and return 405.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getServiceClient } from '../../lib/supabase.js';
import { TOOL_SCHEMAS, DESTRUCTIVE_TOOLS, executeTool } from '../../lib/assistant/tools.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';

const MCP_TOOLS = TOOL_SCHEMAS
    .filter(t => !DESTRUCTIVE_TOOLS.has(t.name))
    .map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

const ALLOWED = new Set(MCP_TOOLS.map(t => t.name));

const INSTRUCTIONS = `BreedIQ is this breeder's system of record for their dog breeding program
(dogs, litters, guardians, heats, calendar). Changes made here appear
immediately in the BreedIQ app and on the breeder's synced calendar.

Common flows:
- Litter updates: update_litter by dam name ("Rainey's litter → born,
  8 puppies, whelped today"). Litter statuses: planned → confirmed → born
  → available → placed → archived.
- A dam was bred: create_litter with dam name, sire name and breed_date —
  the due date is computed automatically.
- Heat tracking: log_heat when a girl comes into heat.
- Situational awareness: get_program_overview first for anything
  summary-shaped.

Dates are YYYY-MM-DD. Identify records by name (dam_name_match /
name_match) when you don't have a UUID. Deleting records is only possible
inside the BreedIQ app, by design.`;

function buildServer(supabase, userId) {
    const server = new Server(
        { name: 'breediq', version: '1.0.0' },
        { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const name = req.params.name;
        if (!ALLOWED.has(name)) {
            return { content: [{ type: 'text', text: `Tool "${name}" is not available over MCP.` }], isError: true };
        }
        const result = await executeTool(name, {
            user_id: userId,
            supabase,
            input: req.params.arguments || {},
            confirm_delete: false
        });
        if (result.ok) {
            return { content: [{ type: 'text', text: JSON.stringify(result.result) }] };
        }
        return { content: [{ type: 'text', text: `Error: ${result.error || 'Tool failed'}` }], isError: true };
    });

    return server;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({
            jsonrpc: '2.0', id: null,
            error: { code: -32000, message: 'Method not allowed. This MCP server is stateless — POST only.' }
        });
    }

    let token = req.query && req.query.token;
    if (Array.isArray(token)) token = token[0];
    if (typeof token !== 'string' || token.length < 16) {
        return res.status(401).json({
            jsonrpc: '2.0', id: null,
            error: { code: -32001, message: 'Invalid MCP token.' }
        });
    }

    try {
        const supabase = getServiceClient();
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('mcp_token', token)
            .limit(1);

        if (error) {
            console.error('[mcp] profile lookup failed:', error);
            return res.status(500).json({
                jsonrpc: '2.0', id: null,
                error: { code: -32603, message: 'Internal error' }
            });
        }
        const profile = profiles && profiles[0];
        if (!profile) {
            return res.status(401).json({
                jsonrpc: '2.0', id: null,
                error: { code: -32001, message: 'Invalid MCP token.' }
            });
        }

        if (enforce(req, res, { name: 'mcp', userId: profile.id, ...LIMITS.mcp })) return;

        const server = buildServer(supabase, profile.id);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,   // stateless
            enableJsonResponse: true         // plain JSON, no SSE needed
        });
        res.on('close', () => { transport.close(); server.close(); });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error('[mcp] handler error:', err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0', id: null,
                error: { code: -32603, message: 'Internal error' }
            });
        }
    }
}
