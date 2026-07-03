CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auditor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    scan_type TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast counting per month
CREATE INDEX IF NOT EXISTS idx_usage_logs_monthly 
ON usage_logs (auditor_id, scan_type, platform, created_at);

-- Set up RLS to be fully secure (only insertable/readable by Edge Function or Admin)
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
