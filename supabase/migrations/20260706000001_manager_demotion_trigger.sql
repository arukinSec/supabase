-- Trigger to handle automated member locking when manager tier changes
CREATE OR REPLACE FUNCTION public.trg_on_manager_tier_change_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier THEN
    IF NEW.tier = 'FREE' THEN
      -- 1. Self-audit connection is updated to FREE
      UPDATE public.members 
      SET tier = 'FREE' 
      WHERE manager_id = NEW.id AND LOWER(email) = LOWER(NEW.email);
      
      -- 2. All other connected members are updated to LOCKED
      UPDATE public.members 
      SET tier = 'LOCKED' 
      WHERE manager_id = NEW.id AND LOWER(email) != LOWER(NEW.email);
    ELSIF NEW.tier = 'PRO' THEN
      -- Upgrade members back to PRO up to quota limits (1 base self audit + additional slots)
      -- The quotas will be synced by sync_manager_quotas
      UPDATE public.members 
      SET tier = 'PRO' 
      WHERE manager_id = NEW.id AND LOWER(email) = LOWER(NEW.email);
      
      -- Update other connections up to limit
      -- (We can let the manager manually unlock them or automatically unlock the first N slots)
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_manager_tier_change ON public.managers;
CREATE TRIGGER trg_on_manager_tier_change
  AFTER UPDATE OF tier ON public.managers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_on_manager_tier_change_func();
