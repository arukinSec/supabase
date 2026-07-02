-- Arukin Secure Audit Gateway Schema

-- 1. Auditors (The admins/investigators logging into the dashboard)
CREATE TABLE IF NOT EXISTS auditors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  auth_id VARCHAR(100) UNIQUE NOT NULL, -- Public unique code (e.g. 'alex-guard') for members to link
  tier VARCHAR(50) DEFAULT 'FREE' NOT NULL, -- 'FREE' or 'PRO'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Members (The users who have connected their Google accounts to an auditor)
CREATE TABLE IF NOT EXISTS members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  provider_id TEXT UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'Access Granted',
  
  -- Link back to the auditor who manages this member
  auditor_id UUID REFERENCES auditors(id) ON DELETE SET NULL,
  
  -- Credentials
  access_token TEXT,
  google_refresh_token TEXT,
  
  consent_granted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Audit Logs (Immutable tracking for security compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auditor_id UUID REFERENCES auditors(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL, -- e.g., 'TRASH_EMAIL', 'DOWNLOAD_FILE'
  resource_id TEXT, -- e.g., Gmail Message ID or Google Drive File ID
  metadata JSONB, -- Any extra context
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. App Config (Global variables, e.g. admin PIN codes)
CREATE TABLE IF NOT EXISTS app_config (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL
);
