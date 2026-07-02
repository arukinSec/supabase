DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS auditors CASCADE;

-- 1. Auditors (The admins/investigators)
CREATE TABLE auditors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) DEFAULT 'TRIAL',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Members (The connected Google accounts)
CREATE TABLE members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  provider_id TEXT UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'Access Granted',
  access_token TEXT,
  google_refresh_token TEXT,
  consent_granted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Audit Logs (Immutable tracking for security compliance)
CREATE TABLE audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auditor_id UUID REFERENCES auditors(id),
  member_id UUID REFERENCES members(id),
  action_type VARCHAR(100) NOT NULL, 
  resource_id TEXT, 
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
