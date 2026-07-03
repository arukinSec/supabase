-- Phase 1 Fix: Drop the permissive RLS policy that was never revoked
-- This policy overrides all later auth-bound policies and allows any user to read/write/delete any member record
DROP POLICY IF EXISTS "Enable all operations for all roles" ON public.members;
