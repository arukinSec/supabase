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

  SELECT count(*) INTO member_count FROM members WHERE manager_id = v_manager.id AND connection_status = 'CONNECTED';

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
      -- A PRO manager allows (4 + additional_slots) ACTIVE connections total
      IF member_count >= (4 + COALESCE(v_manager.additional_slots, 0)) THEN
        NEW.tier := 'LOCKED';
      ELSE
        NEW.tier := 'PRO';
      END IF;
    ELSIF v_manager.tier = 'TRIAL' THEN
      -- A TRIAL manager allows 2 ACTIVE connections total (1 own + 1 other).
      IF member_count >= 2 THEN
        NEW.tier := 'LOCKED';
      ELSE
        NEW.tier := 'FREE';
      END IF;
    ELSE
      -- A FREE manager allows 1 ACTIVE connection total (someone else's).
      IF member_count >= 1 THEN
        NEW.tier := 'LOCKED';
      ELSE
        NEW.tier := 'FREE';
      END IF;
    END IF;
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
  -- When manager upgrades to PRO, flip up to (4 + additional slots) connected members to PRO
  IF NEW.tier = 'PRO' AND (OLD.tier IS DISTINCT FROM 'PRO') THEN
    UPDATE members 
    SET tier = 'PRO' 
    WHERE id IN (
      SELECT id FROM members 
      WHERE manager_id = NEW.id AND connection_status = 'CONNECTED'
      ORDER BY (CASE WHEN LOWER(email) = LOWER(NEW.email) THEN 0 ELSE 1 END), created_at ASC
      LIMIT (4 + COALESCE(NEW.additional_slots, 0))
    );

    UPDATE members
    SET tier = 'LOCKED'
    WHERE manager_id = NEW.id 
    AND connection_status = 'CONNECTED'
    AND tier != 'PRO';
  END IF;

  -- If manager downgrades from PRO (e.g. to FREE or TRIAL)
  IF NEW.tier != 'PRO' AND OLD.tier = 'PRO' THEN
    -- First, set everyone to LOCKED to safely restrict everything
    UPDATE members SET tier = 'LOCKED' WHERE manager_id = NEW.id;
    
    -- If they downgraded to TRIAL, their own account becomes PRO
    IF NEW.tier = 'TRIAL' THEN
      UPDATE members SET tier = 'PRO' WHERE manager_id = NEW.id AND LOWER(email) = LOWER(NEW.email);
      -- 1 other account becomes FREE
      UPDATE members 
      SET tier = 'FREE' 
      WHERE id IN (
        SELECT id FROM members 
        WHERE manager_id = NEW.id 
        AND connection_status = 'CONNECTED' 
        AND LOWER(email) != LOWER(NEW.email)
        ORDER BY created_at ASC
        LIMIT 1
      );
    ELSIF NEW.tier = 'FREE' THEN
       -- FREE tier gets 1 active account (someone else's)
       UPDATE members 
      SET tier = 'FREE' 
      WHERE id IN (
        SELECT id FROM members 
        WHERE manager_id = NEW.id 
        AND connection_status = 'CONNECTED'
        ORDER BY created_at ASC
        LIMIT 1
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
