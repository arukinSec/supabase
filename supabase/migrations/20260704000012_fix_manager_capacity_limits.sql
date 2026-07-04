CREATE OR REPLACE FUNCTION public.verify_manager_capacity(auth_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    max_allowed := 5 + COALESCE(found_manager.additional_slots, 0);
  ELSIF found_manager.tier = 'TRIAL' THEN
    max_allowed := 4;
  ELSE
    max_allowed := 3;
  END IF;

  IF member_count >= max_allowed THEN
    RETURN json_build_object('valid', false, 'error', 'This manager has reached their maximum connection limit.');
  END IF;

  RETURN json_build_object('valid', true, 'manager_id', found_manager.id);
END;
$$;
