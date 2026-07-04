-- 20260704000015_tier_schema.sql

-- 1. Create the Tiers table
CREATE TABLE public.tiers (
  id text PRIMARY KEY,
  name text NOT NULL,
  base_max_active integer NOT NULL,
  base_max_total integer NOT NULL,
  slot_price_yearly numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Insert foundational tiers
INSERT INTO public.tiers (id, name, base_max_active, base_max_total, slot_price_yearly) VALUES
  ('FREE', 'Free Tier', 1, 3, 0),
  ('TRIAL', 'Trial Tier', 2, 4, 0),
  ('PRO', 'Pro Tier', 4, 5, 1200);

-- 3. Create the Platform Features table
CREATE TABLE public.platform_features (
  id text PRIMARY KEY,
  name text NOT NULL,
  minimum_tier_id text REFERENCES public.tiers(id),
  description text
);

INSERT INTO public.platform_features (id, name, minimum_tier_id, description) VALUES
  ('INTEL_FINANCIAL', 'Financial Footprints Scan', 'PRO', 'Deep scan of connected financial services'),
  ('INTEL_DRIVE', 'Drive Forensics', 'PRO', 'Metadata and content scanning in Drive'),
  ('TARGET_MONITOR', 'Continuous Target Monitoring', 'TRIAL', 'Live monitoring of connected targets'),
  ('OSINT_BASIC', 'Basic OSINT Scan', 'FREE', 'Basic footprinting and connected apps analysis');

-- 4. Alter Managers table
ALTER TABLE public.managers 
  ADD COLUMN current_active_connections integer DEFAULT 0,
  ADD COLUMN current_total_connections integer DEFAULT 0,
  ADD COLUMN has_self_audit boolean DEFAULT false;

-- We already have `additional_slots`, so we will keep it as the additional slots bought counter.
UPDATE public.managers SET tier = 'FREE' WHERE tier NOT IN ('FREE', 'TRIAL', 'PRO');
ALTER TABLE public.managers ADD CONSTRAINT fk_managers_tier FOREIGN KEY (tier) REFERENCES public.tiers(id);

-- 5. Create Sync Function
CREATE OR REPLACE FUNCTION public.sync_manager_quotas(mgr_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active int;
  v_total int;
  v_self_audit boolean;
  v_manager record;
BEGIN
  -- Count active (PRO/FREE)
  SELECT count(*) INTO v_active FROM public.members 
  WHERE manager_id = mgr_id AND connection_status = 'CONNECTED' AND tier IN ('PRO', 'FREE');
  
  -- Count total connected
  SELECT count(*) INTO v_total FROM public.members 
  WHERE manager_id = mgr_id AND connection_status = 'CONNECTED';
  
  -- Check self audit
  SELECT * INTO v_manager FROM public.managers WHERE id = mgr_id;
  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1 FROM public.members 
      WHERE manager_id = mgr_id 
      AND LOWER(email) = LOWER(v_manager.email) 
      AND connection_status = 'CONNECTED'
    ) INTO v_self_audit;
    
    UPDATE public.managers SET 
      current_active_connections = v_active,
      current_total_connections = v_total,
      has_self_audit = v_self_audit
    WHERE id = mgr_id;
  END IF;
END;
$$;

-- 6. Replace `assign_member_tier_on_connect_exact` to use Tiers table logic
CREATE OR REPLACE FUNCTION public.assign_member_tier_on_connect_exact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manager record;
  v_tier record;
  is_self boolean;
  active_allowed integer;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_manager FROM managers WHERE id = NEW.manager_id;
  SELECT * INTO v_tier FROM tiers WHERE id = v_manager.tier;
  
  is_self := LOWER(NEW.email) = LOWER(v_manager.email);
  active_allowed := v_tier.base_max_active + COALESCE(v_manager.additional_slots, 0);

  IF is_self THEN
    IF v_manager.tier = 'FREE' THEN
      UPDATE managers SET tier = 'TRIAL' WHERE id = v_manager.id;
      v_manager.tier := 'TRIAL';
    END IF;
    NEW.tier := 'PRO';
  ELSE
    -- If adding this new one exceeds allowed active
    IF v_manager.current_active_connections >= active_allowed THEN
      NEW.tier := 'LOCKED';
    ELSE
      IF v_manager.tier = 'PRO' THEN
        NEW.tier := 'PRO';
      ELSE
        NEW.tier := 'FREE';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Trigger to auto-sync quotas when members change
CREATE OR REPLACE FUNCTION public.trg_sync_manager_quotas_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.sync_manager_quotas(NEW.manager_id);
  END IF;
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    PERFORM public.sync_manager_quotas(OLD.manager_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_manager_quotas ON public.members;
CREATE TRIGGER trg_sync_manager_quotas
  AFTER INSERT OR UPDATE OF connection_status, tier OR DELETE ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_manager_quotas_func();

-- 8. Run sync on all existing managers initially
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT id FROM public.managers LOOP
    PERFORM public.sync_manager_quotas(m.id);
  END LOOP;
END;
$$;

-- 9. Replace `verify_manager_capacity` to use new DB constraints
CREATE OR REPLACE FUNCTION public.verify_manager_capacity(auth_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  found_manager record;
  found_tier record;
  max_allowed integer;
BEGIN
  SELECT * INTO found_manager FROM managers WHERE auth_id = auth_code;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  SELECT * INTO found_tier FROM tiers WHERE id = found_manager.tier;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  max_allowed := found_tier.base_max_total + COALESCE(found_manager.additional_slots, 0);

  IF found_manager.current_total_connections >= max_allowed THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
