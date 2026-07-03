-- Function to assign initial tier and handle self-audit upgrade
CREATE OR REPLACE FUNCTION assign_member_tier_exact()
RETURNS TRIGGER AS $$
DECLARE
  v_auditor RECORD;
  v_member_index INT;
BEGIN
  IF NEW.auditor_id IS NULL THEN
    IF NEW.tier IS NULL THEN
      NEW.tier := 'FREE';
    END IF;
    RETURN NEW;
  END IF;

  SELECT id, email, tier INTO v_auditor FROM auditors WHERE id = NEW.auditor_id;
  
  -- If auditor is FREE and connects their own account, auto-upgrade to TRIAL
  IF v_auditor.tier = 'FREE' AND LOWER(NEW.email) = LOWER(v_auditor.email) THEN
    UPDATE auditors SET tier = 'TRIAL' WHERE id = v_auditor.id;
    v_auditor.tier := 'TRIAL';
  END IF;
  
  -- Determine the index of this new member (how many members existed before this one)
  SELECT COUNT(*) INTO v_member_index FROM members WHERE auditor_id = NEW.auditor_id;
  
  IF v_auditor.tier = 'PRO' THEN
    IF v_member_index < 4 THEN
      NEW.tier := 'PRO';
    ELSE
      NEW.tier := 'FREE';
    END IF;
  ELSIF v_auditor.tier = 'TRIAL' THEN
    IF v_member_index = 0 THEN
      NEW.tier := 'PRO';
    ELSE
      NEW.tier := 'FREE';
    END IF;
  ELSE
    -- FREE tier
    NEW.tier := 'FREE';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_member_tier ON members;
CREATE TRIGGER trg_assign_member_tier
BEFORE INSERT ON members
FOR EACH ROW
EXECUTE FUNCTION assign_member_tier_exact();

-- Function to upgrade top 4 members to PRO when auditor upgrades
CREATE OR REPLACE FUNCTION update_members_tier_on_upgrade_exact()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tier = 'PRO' AND (OLD.tier IS NULL OR OLD.tier != 'PRO') THEN
    -- Update the first 4 members to PRO
    UPDATE members SET tier = 'PRO' 
    WHERE id IN (
      SELECT id FROM members 
      WHERE auditor_id = NEW.id 
      ORDER BY created_at ASC 
      LIMIT 4
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_members_tier ON auditors;
CREATE TRIGGER trg_update_members_tier
AFTER UPDATE OF tier ON auditors
FOR EACH ROW
EXECUTE FUNCTION update_members_tier_on_upgrade_exact();
