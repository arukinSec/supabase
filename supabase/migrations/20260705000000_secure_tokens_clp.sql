-- Revoke complete SELECT access to the members table for the public roles
REVOKE SELECT ON TABLE public.members FROM anon, authenticated, public;

-- Grant SELECT access only to safe columns (omitting access_token and google_refresh_token)
GRANT SELECT (
    id, 
    email, 
    name, 
    avatar_url, 
    provider_id, 
    consent_granted_at, 
    status, 
    connection_status, 
    created_at, 
    updated_at, 
    manager_id, 
    inputted_auth_id, 
    slot_no, 
    tier
) ON TABLE public.members TO anon, authenticated;

-- Service role still needs full access
GRANT ALL ON TABLE public.members TO service_role;
