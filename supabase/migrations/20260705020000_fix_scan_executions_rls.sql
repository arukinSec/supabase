-- Drop the broken RLS policy on scan_executions
DROP POLICY IF EXISTS "Managers can view their own scan executions" ON public.scan_executions;

-- Create the correct RLS policy linking the manager via their authenticated email
CREATE POLICY "Managers can view their own scan executions"
ON public.scan_executions
AS PERMISSIVE
FOR SELECT
TO public
USING (
  manager_id IN (
    SELECT managers.id 
    FROM public.managers 
    WHERE LOWER(managers.email) = LOWER(auth.jwt() ->> 'email')
  )
);
