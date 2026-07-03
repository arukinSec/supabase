-- Phase 1 Fix: Add RLS policies for usage_logs
-- Table had RLS enabled but no policies defined, leaving it readable by any authenticated user
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auditors can view their own usage logs"
ON public.usage_logs
FOR SELECT
TO authenticated
USING (auditor_id = auth.uid());
