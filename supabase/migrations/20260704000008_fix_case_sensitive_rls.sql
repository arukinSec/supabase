-- Fix case sensitive email matching in RLS policies

-- 1. Drop existing policies on members
DROP POLICY IF EXISTS "Auditors can view and manage their connected members" ON "public"."members";
DROP POLICY IF EXISTS "Members can manage their own connection" ON "public"."members";

-- Recreate members policies with LOWER()
CREATE POLICY "Auditors can view and manage their connected members"
ON "public"."members"
AS PERMISSIVE
FOR ALL
TO public
USING (
  auditor_id IN (
    SELECT auditors.id FROM public.auditors 
    WHERE LOWER(auditors.email) = LOWER(auth.jwt() ->> 'email')
  )
);

CREATE POLICY "Members can manage their own connection"
ON "public"."members"
AS PERMISSIVE
FOR ALL
TO public
USING (LOWER(email) = LOWER(auth.jwt() ->> 'email'));


-- 2. Drop existing policies on auditors
DROP POLICY IF EXISTS "Auditors can manage their own profile" ON "public"."auditors";

-- Recreate auditors policies with LOWER()
CREATE POLICY "Auditors can manage their own profile"
ON "public"."auditors"
AS PERMISSIVE
FOR ALL
TO public
USING (LOWER(email) = LOWER(auth.jwt() ->> 'email'))
WITH CHECK (LOWER(email) = LOWER(auth.jwt() ->> 'email'));


-- 3. Drop existing policies on audit_logs
DROP POLICY IF EXISTS "Auditors can manage audit logs" ON "public"."audit_logs";

-- Recreate audit logs policies with LOWER()
CREATE POLICY "Auditors can manage audit logs"
ON "public"."audit_logs"
AS PERMISSIVE
FOR ALL
TO public
USING (
  auditor_id IN (
    SELECT auditors.id FROM public.auditors 
    WHERE LOWER(auditors.email) = LOWER(auth.jwt() ->> 'email')
  )
);
