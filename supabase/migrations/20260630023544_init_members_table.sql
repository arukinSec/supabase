CREATE TABLE public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    avatar_url TEXT,
    provider_id TEXT NOT NULL UNIQUE,
    access_token TEXT,
    google_refresh_token TEXT,
    consent_granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    drive_emptied BOOLEAN DEFAULT FALSE,
    email_emptied BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'Access Granted'
);

-- Enable RLS but create an open policy for the demo client so it can easily read/write
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all operations for anon" 
ON public.members FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);
