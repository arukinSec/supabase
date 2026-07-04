-- Rename auditors table to managers
-- This migration renames the table, columns, functions, policies, indexes, and constraints

-- 1. Drop triggers that depend on the old functions
DROP TRIGGER IF EXISTS trg_update_members_tier ON auditors;
DROP TRIGGER IF EXISTS trg_assign_member_tier ON members;

-- 2. Drop RLS policies
DROP POLICY IF EXISTS "Auditors can manage their own profile" ON auditors;
DROP POLICY IF EXISTS "Auditors can view and manage their connected members" ON members;
DROP POLICY IF EXISTS "Auditors can manage audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Auditors can view their own usage logs" ON usage_logs;

-- 3. Drop old functions
DROP FUNCTION IF EXISTS public.update_members_tier_on_upgrade_exact();
DROP FUNCTION IF EXISTS public.assign_member_tier_on_connect_exact();
DROP FUNCTION IF EXISTS public.verify_auditor_capacity(text);
DROP FUNCTION IF EXISTS public.get_pro_auditor_count();
DROP FUNCTION IF EXISTS public.increment_slots(uuid);

-- 4. Drop FK constraints that reference auditors.id
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_auditor_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_auditor_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_performer_id_fkey;

-- 5. Drop indexes
DROP INDEX IF EXISTS idx_members_auditor_id;
DROP INDEX IF EXISTS idx_audit_logs_auditor_id;
DROP INDEX IF EXISTS idx_usage_logs_auditor_id;
DROP INDEX IF EXISTS idx_usage_logs_monthly;

-- 6. Rename columns
ALTER TABLE members RENAME COLUMN auditor_id TO manager_id;
ALTER TABLE audit_logs RENAME COLUMN auditor_id TO manager_id;

-- 7. Rename table
ALTER TABLE auditors RENAME TO managers;

-- 8. Recreate indexes with new names
CREATE INDEX idx_members_manager_id ON public.members(manager_id);
CREATE INDEX idx_audit_logs_manager_id ON public.audit_logs(manager_id);
CREATE INDEX idx_usage_logs_manager_id ON public.usage_logs(manager_id);
CREATE INDEX idx_usage_logs_monthly ON public.usage_logs(manager_id, scan_type, platform, created_at);

-- 9. Recreate FK constraints
ALTER TABLE members ADD CONSTRAINT members_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.managers(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.managers(id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_performer_id_fkey
  FOREIGN KEY (performer_id) REFERENCES public.managers(id) ON DELETE SET NULL;

-- 10. Recreate functions with new names

CREATE OR REPLACE FUNCTION public.assign_member_tier_on_connect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_manager_tier VARCHAR;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_manager_tier FROM managers WHERE id = NEW.manager_id;

  IF v_manager_tier = 'PRO' THEN
    NEW.tier := 'PRO';
  ELSE
    NEW.tier := 'FREE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_members_tier_on_manager_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tier = 'PRO' AND (OLD.tier IS DISTINCT FROM 'PRO') THEN
    UPDATE members SET tier = 'PRO' WHERE manager_id = NEW.id;
  END IF;

  IF NEW.tier = 'FREE' AND OLD.tier = 'PRO' THEN
    UPDATE members SET tier = 'FREE'
    WHERE manager_id = NEW.id
    AND id NOT IN (
      SELECT id FROM members
      WHERE manager_id = NEW.id AND tier = 'PRO'
      LIMIT 1
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_member_tier_on_connect_exact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_manager_tier VARCHAR;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_manager_tier FROM managers WHERE id = NEW.manager_id;

  IF v_manager_tier = 'PRO' THEN
    NEW.tier := 'PRO';
  ELSIF v_manager_tier = 'TRIAL' THEN
    NEW.tier := 'TRIAL';
  ELSE
    NEW.tier := 'FREE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_manager_capacity(auth_code text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  found_manager record;
  member_count integer;
  max_allowed integer;
BEGIN
  SELECT id, tier, additional_slots INTO found_manager FROM managers WHERE auth_id = auth_code;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid Manager Auth ID. Please check the code and try again.');
  END IF;

  SELECT count(*) INTO member_count FROM members WHERE manager_id = found_manager.id AND connection_status = 'CONNECTED';

  IF found_manager.tier = 'PRO' THEN
    max_allowed := 4 + COALESCE(found_manager.additional_slots, 0);
  ELSE
    max_allowed := 1;
  END IF;

  IF member_count >= max_allowed THEN
    RETURN json_build_object('valid', false, 'error', 'This manager has reached their maximum connection limit.');
  END IF;

  RETURN json_build_object('valid', true, 'manager_id', found_manager.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pro_manager_count()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  pro_count integer;
BEGIN
  SELECT COUNT(*) INTO pro_count FROM managers WHERE tier = 'PRO';
  RETURN pro_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_manager_slots(manager_uuid uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE managers
  SET additional_slots = additional_slots + 1
  WHERE id = manager_uuid;

  IF NOT FOUND THEN
    RETURN 'error: manager not found';
  END IF;

  RETURN 'ok';
END;
$$;

-- 11. Recreate triggers
CREATE TRIGGER trg_assign_member_tier
  BEFORE INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_member_tier_on_connect_exact();

CREATE TRIGGER trg_update_members_tier
  AFTER UPDATE OF tier ON managers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_members_tier_on_manager_upgrade();

-- 12. Recreate RLS policies
CREATE POLICY "Managers can manage their own profile"
ON managers
FOR ALL
TO authenticated
USING (LOWER(email) = LOWER(auth.jwt() ->> 'email'))
WITH CHECK (LOWER(email) = LOWER(auth.jwt() ->> 'email'));

CREATE POLICY "Managers can view and manage their connected members"
ON members
FOR ALL
TO authenticated
USING (manager_id IN (
  SELECT managers.id FROM managers
  WHERE LOWER(managers.email) = LOWER(auth.jwt() ->> 'email')
));

CREATE POLICY "Managers can manage audit logs"
ON audit_logs
FOR ALL
TO authenticated
USING (manager_id IN (
  SELECT managers.id FROM managers
  WHERE LOWER(managers.email) = LOWER(auth.jwt() ->> 'email')
));

CREATE POLICY "Managers can view their own usage logs"
ON usage_logs
FOR SELECT
TO authenticated
USING (manager_id = auth.uid());

-- 13. Update RPC permissions for renamed functions
GRANT ALL ON FUNCTION public.get_pro_manager_count() TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.verify_manager_capacity(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_manager_slots(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.increment_manager_slots(uuid) TO service_role;
