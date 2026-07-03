-- Add tier to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'FREE' NOT NULL;

-- Function to assign initial tier to a new member based on auditor's tier
CREATE OR REPLACE FUNCTION assign_member_tier()
RETURNS TRIGGER AS $$
DECLARE
  v_auditor_tier VARCHAR;
  v_pro_count INT;
BEGIN
  IF NEW.auditor_id IS NULL THEN
    IF NEW.tier IS NULL THEN
      NEW.tier := 'FREE';
    END IF;
    RETURN NEW;
  END IF;

  SELECT tier INTO v_auditor_tier FROM auditors WHERE id = NEW.auditor_id;
  
  IF v_auditor_tier = 'PRO' THEN
    NEW.tier := 'PRO';
  ELSE
    -- For TRIAL/FREE auditors, they get 1 PRO member (their own), the rest are FREE
    SELECT COUNT(*) INTO v_pro_count FROM members 
    WHERE auditor_id = NEW.auditor_id AND tier = 'PRO' AND id != NEW.id;
    
    IF v_pro_count = 0 THEN
      NEW.tier := 'PRO';
    ELSE
      NEW.tier := 'FREE';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_member_tier ON members;
CREATE TRIGGER trg_assign_member_tier
BEFORE INSERT ON members
FOR EACH ROW
EXECUTE FUNCTION assign_member_tier();

-- Function to upgrade members when auditor upgrades
CREATE OR REPLACE FUNCTION update_members_tier_on_upgrade()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tier = 'PRO' AND (OLD.tier IS NULL OR OLD.tier != 'PRO') THEN
    UPDATE members SET tier = 'PRO' WHERE auditor_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_members_tier ON auditors;
CREATE TRIGGER trg_update_members_tier
AFTER UPDATE OF tier ON auditors
FOR EACH ROW
EXECUTE FUNCTION update_members_tier_on_upgrade();
