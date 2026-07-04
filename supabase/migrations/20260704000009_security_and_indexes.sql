-- 1. Secure increment_slots RPC
-- Revoke from public, anon, and authenticated so only service_role can execute it
REVOKE EXECUTE ON FUNCTION public.increment_slots(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_slots(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_slots(uuid) TO service_role;

-- 2. Lock down search_path on get_pro_auditor_count
CREATE OR REPLACE FUNCTION get_pro_auditor_count()
RETURNS INT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pro_count INT;
BEGIN
  SELECT COUNT(*) INTO pro_count FROM auditors WHERE tier = 'PRO';
  RETURN pro_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Add performance indexes for foreign keys
CREATE INDEX IF NOT EXISTS idx_members_auditor_id ON public.members(auditor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_auditor_id ON public.audit_logs(auditor_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_auditor_id ON public.usage_logs(auditor_id);
