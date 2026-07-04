CREATE OR REPLACE FUNCTION public.assign_member_tier_on_connect_exact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager record;
  is_self boolean;
  member_count integer;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_manager FROM managers WHERE id = NEW.manager_id;
  
  -- 1. Is this the manager's own account?
  is_self := LOWER(NEW.email) = LOWER(v_manager.email);

  IF is_self THEN
    -- If they were FREE, auto-upgrade them to TRIAL
    IF v_manager.tier = 'FREE' THEN
      UPDATE managers SET tier = 'TRIAL' WHERE id = v_manager.id;
      v_manager.tier := 'TRIAL';
    END IF;
    -- Manager's own account ALWAYS gets PRO tier access
    NEW.tier := 'PRO';
  ELSE
    -- If it's NOT their own account
    IF v_manager.tier = 'PRO' THEN
      SELECT count(*) INTO member_count FROM members WHERE manager_id = v_manager.id AND connection_status = 'CONNECTED';
      -- A PRO manager without extra slots allows 4 active connections total (1 own + 3 others).
      -- If member_count >= 4, it means they are adding their 5th connection, which stays FREE until a slot is bought.
      IF member_count >= 4 THEN
        NEW.tier := 'FREE';
      ELSE
        NEW.tier := 'PRO';
      END IF;
    ELSE
      -- For FREE or TRIAL managers, other accounts are ALWAYS FREE
      NEW.tier := 'FREE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.demote_manager_on_self_disconnect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.connection_status = 'CONNECTED' AND NEW.connection_status != 'CONNECTED' THEN
      SELECT * INTO v_manager FROM managers WHERE id = NEW.manager_id;
      IF LOWER(NEW.email) = LOWER(v_manager.email) AND v_manager.tier = 'TRIAL' THEN
        UPDATE managers SET tier = 'FREE' WHERE id = v_manager.id;
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT * INTO v_manager FROM managers WHERE id = OLD.manager_id;
    IF LOWER(OLD.email) = LOWER(v_manager.email) AND v_manager.tier = 'TRIAL' THEN
      UPDATE managers SET tier = 'FREE' WHERE id = v_manager.id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_demote_manager_on_disconnect ON members;
CREATE TRIGGER trg_demote_manager_on_disconnect
  AFTER UPDATE OF connection_status OR DELETE ON members
  FOR EACH ROW
  EXECUTE FUNCTION public.demote_manager_on_self_disconnect();


CREATE OR REPLACE FUNCTION public.update_members_tier_on_manager_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When manager upgrades to PRO, flip up to 4 connected members to PRO
  IF NEW.tier = 'PRO' AND (OLD.tier IS DISTINCT FROM 'PRO') THEN
    UPDATE members 
    SET tier = 'PRO' 
    WHERE id IN (
      SELECT id FROM members 
      WHERE manager_id = NEW.id AND connection_status = 'CONNECTED'
      ORDER BY (CASE WHEN LOWER(email) = LOWER(NEW.email) THEN 0 ELSE 1 END), created_at ASC
      LIMIT 4
    );
  END IF;

  -- If manager downgrades from PRO (e.g. to FREE or TRIAL)
  IF NEW.tier != 'PRO' AND OLD.tier = 'PRO' THEN
    -- First, set everyone to FREE
    UPDATE members SET tier = 'FREE' WHERE manager_id = NEW.id;
    
    -- If they downgraded to TRIAL, their own account becomes PRO
    IF NEW.tier = 'TRIAL' THEN
      UPDATE members SET tier = 'PRO' WHERE manager_id = NEW.id AND LOWER(email) = LOWER(NEW.email);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
