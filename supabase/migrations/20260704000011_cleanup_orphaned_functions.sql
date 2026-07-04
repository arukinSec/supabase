-- Clean up old function names that were not dropped during the rename migration
DROP FUNCTION IF EXISTS public.update_members_tier_on_upgrade();
DROP FUNCTION IF EXISTS public.assign_member_tier();
DROP FUNCTION IF EXISTS public.assign_member_tier_exact();
DROP FUNCTION IF EXISTS public.assign_member_tier_on_connect_exact();
