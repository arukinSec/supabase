-- Migration to update auditors and members tables for multi-auditing
ALTER TABLE auditors ADD COLUMN IF NOT EXISTS auth_id VARCHAR(100) UNIQUE;
ALTER TABLE auditors ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'FREE' NOT NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS auditor_id UUID REFERENCES auditors(id) ON DELETE SET NULL;
