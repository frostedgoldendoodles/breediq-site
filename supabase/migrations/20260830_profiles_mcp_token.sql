-- MCP access token — gates the Streamable HTTP MCP server at
-- /api/mcp/:token. Same pattern as calendar_feed_token: a long random
-- bearer stored on the profile, rotatable by overwriting. NULL = MCP not
-- enabled for that account.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mcp_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_mcp_token
    ON public.profiles(mcp_token) WHERE mcp_token IS NOT NULL;
