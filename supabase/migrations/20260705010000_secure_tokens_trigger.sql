-- Create a trigger function to sync Google OAuth tokens directly from auth.identities to public.members
-- This completely removes the need for the frontend to send tokens to the database.

CREATE OR REPLACE FUNCTION public.sync_identity_tokens_to_members()
RETURNS TRIGGER AS $$
DECLARE
  v_access_token text;
  v_refresh_token text;
  v_email text;
  v_name text;
  v_avatar_url text;
BEGIN
  -- We only care about Google identities
  IF NEW.provider = 'google' THEN
    -- Extract tokens from the identity_data JSONB
    v_access_token := NEW.identity_data->>'provider_token';
    v_refresh_token := NEW.identity_data->>'provider_refresh_token';
    v_email := NEW.identity_data->>'email';
    v_name := NEW.identity_data->>'full_name';
    v_avatar_url := NEW.identity_data->>'avatar_url';

    -- Only proceed if we have an access token
    IF v_access_token IS NOT NULL THEN
      -- Upsert into public.members
      INSERT INTO public.members (
        provider_id,
        access_token,
        google_refresh_token,
        email,
        name,
        avatar_url,
        connection_status
      ) VALUES (
        NEW.id::text,
        v_access_token,
        v_refresh_token,
        v_email,
        v_name,
        v_avatar_url,
        'CONNECTED'
      )
      ON CONFLICT (provider_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        google_refresh_token = COALESCE(EXCLUDED.google_refresh_token, public.members.google_refresh_token),
        email = COALESCE(EXCLUDED.email, public.members.email),
        name = COALESCE(EXCLUDED.name, public.members.name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.members.avatar_url),
        connection_status = 'CONNECTED',
        updated_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create it
DROP TRIGGER IF EXISTS on_auth_identity_created_or_updated ON auth.identities;
CREATE TRIGGER on_auth_identity_created_or_updated
AFTER INSERT OR UPDATE ON auth.identities
FOR EACH ROW
EXECUTE FUNCTION public.sync_identity_tokens_to_members();

-- Note: This trigger runs as SUPERUSER / SECURITY DEFINER, so it can bypass RLS on public.members.
