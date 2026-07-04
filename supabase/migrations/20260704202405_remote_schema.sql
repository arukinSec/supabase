drop policy "Managers can manage audit logs" on "public"."audit_logs";

drop policy "Managers can view their own usage logs" on "public"."usage_logs";

revoke delete on table "public"."audit_logs" from "anon";

revoke insert on table "public"."audit_logs" from "anon";

revoke references on table "public"."audit_logs" from "anon";

revoke select on table "public"."audit_logs" from "anon";

revoke trigger on table "public"."audit_logs" from "anon";

revoke truncate on table "public"."audit_logs" from "anon";

revoke update on table "public"."audit_logs" from "anon";

revoke delete on table "public"."audit_logs" from "authenticated";

revoke insert on table "public"."audit_logs" from "authenticated";

revoke references on table "public"."audit_logs" from "authenticated";

revoke select on table "public"."audit_logs" from "authenticated";

revoke trigger on table "public"."audit_logs" from "authenticated";

revoke truncate on table "public"."audit_logs" from "authenticated";

revoke update on table "public"."audit_logs" from "authenticated";

revoke delete on table "public"."audit_logs" from "service_role";

revoke insert on table "public"."audit_logs" from "service_role";

revoke references on table "public"."audit_logs" from "service_role";

revoke select on table "public"."audit_logs" from "service_role";

revoke trigger on table "public"."audit_logs" from "service_role";

revoke truncate on table "public"."audit_logs" from "service_role";

revoke update on table "public"."audit_logs" from "service_role";

revoke references on table "public"."platform_features" from "anon";

revoke trigger on table "public"."platform_features" from "anon";

revoke truncate on table "public"."platform_features" from "anon";

revoke references on table "public"."platform_features" from "authenticated";

revoke trigger on table "public"."platform_features" from "authenticated";

revoke truncate on table "public"."platform_features" from "authenticated";

revoke references on table "public"."platform_features" from "service_role";

revoke trigger on table "public"."platform_features" from "service_role";

revoke truncate on table "public"."platform_features" from "service_role";

revoke delete on table "public"."usage_logs" from "anon";

revoke insert on table "public"."usage_logs" from "anon";

revoke references on table "public"."usage_logs" from "anon";

revoke select on table "public"."usage_logs" from "anon";

revoke trigger on table "public"."usage_logs" from "anon";

revoke truncate on table "public"."usage_logs" from "anon";

revoke update on table "public"."usage_logs" from "anon";

revoke delete on table "public"."usage_logs" from "authenticated";

revoke insert on table "public"."usage_logs" from "authenticated";

revoke references on table "public"."usage_logs" from "authenticated";

revoke select on table "public"."usage_logs" from "authenticated";

revoke trigger on table "public"."usage_logs" from "authenticated";

revoke truncate on table "public"."usage_logs" from "authenticated";

revoke update on table "public"."usage_logs" from "authenticated";

revoke delete on table "public"."usage_logs" from "service_role";

revoke insert on table "public"."usage_logs" from "service_role";

revoke references on table "public"."usage_logs" from "service_role";

revoke select on table "public"."usage_logs" from "service_role";

revoke trigger on table "public"."usage_logs" from "service_role";

revoke truncate on table "public"."usage_logs" from "service_role";

revoke update on table "public"."usage_logs" from "service_role";

alter table "public"."audit_logs" drop constraint "audit_logs_manager_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_member_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_performer_id_fkey";

alter table "public"."platform_features" drop constraint "platform_features_minimum_tier_id_fkey";

alter table "public"."usage_logs" drop constraint "usage_logs_auditor_id_fkey";

alter table "public"."usage_logs" drop constraint "usage_logs_member_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_pkey";

alter table "public"."platform_features" drop constraint "platform_features_pkey";

alter table "public"."usage_logs" drop constraint "usage_logs_pkey";

drop index if exists "public"."audit_logs_pkey";

drop index if exists "public"."idx_audit_logs_manager_id";

drop index if exists "public"."idx_usage_logs_auditor_id";

drop index if exists "public"."idx_usage_logs_monthly";

drop index if exists "public"."platform_features_pkey";

drop index if exists "public"."usage_logs_pkey";

drop table "public"."audit_logs";

drop table "public"."platform_features";

drop table "public"."usage_logs";


  create table "public"."scan_executions" (
    "id" uuid not null default gen_random_uuid(),
    "manager_id" uuid not null,
    "member_id" uuid not null,
    "scan_category" text not null,
    "scan_depth" text not null,
    "status" text default 'SUCCESS'::text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."scan_executions" enable row level security;

alter table "public"."managers" alter column "role" set default 'manager'::character varying;

alter table "public"."members" add column "slot_no" integer;

alter table "public"."tiers" add column "slot_price_weekly" numeric default 0;

alter table "public"."tiers" enable row level security;

CREATE INDEX idx_scan_executions_counting ON public.scan_executions USING btree (member_id, scan_category, scan_depth, created_at);

CREATE UNIQUE INDEX scan_executions_pkey ON public.scan_executions USING btree (id);

alter table "public"."scan_executions" add constraint "scan_executions_pkey" PRIMARY KEY using index "scan_executions_pkey";

alter table "public"."scan_executions" add constraint "scan_executions_manager_id_fkey" FOREIGN KEY (manager_id) REFERENCES public.managers(id) ON DELETE CASCADE not valid;

alter table "public"."scan_executions" validate constraint "scan_executions_manager_id_fkey";

alter table "public"."scan_executions" add constraint "scan_executions_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."scan_executions" validate constraint "scan_executions_member_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cascade_manager_slots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_oldest_locked_member uuid;
BEGIN
  -- If a slot is being emptied...
  IF OLD.member_id IS NOT NULL AND NEW.member_id IS NULL THEN
    -- Find the oldest connected member that DOES NOT currently have a seat anywhere
    SELECT id INTO v_oldest_locked_member
    FROM public.members
    WHERE manager_id = NEW.manager_id 
      AND connection_status = 'CONNECTED'
      AND id NOT IN (SELECT member_id FROM public.manager_slots WHERE manager_id = NEW.manager_id AND member_id IS NOT NULL)
    ORDER BY created_at ASC
    LIMIT 1;

    -- If we found someone on the waitlist, plug them directly into the newly emptied seat!
    IF FOUND THEN
      NEW.member_id := v_oldest_locked_member;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cascade_member_slots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_oldest_locked_member uuid;
  v_manager record;
  v_tier record;
  target_limit integer;
BEGIN
  IF OLD.slot_no > 0 AND NEW.slot_no IS NULL THEN
    SELECT id INTO v_oldest_locked_member
    FROM public.members
    WHERE manager_id = NEW.manager_id 
      AND connection_status = 'CONNECTED'
      AND slot_no IS NULL
      AND LOWER(email) != (SELECT LOWER(email) FROM public.managers WHERE id = NEW.manager_id)
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_oldest_locked_member IS NOT NULL THEN
      SELECT * INTO v_manager FROM public.managers WHERE id = NEW.manager_id;
      SELECT * INTO v_tier FROM public.tiers WHERE id = v_manager.tier;
      
      IF v_manager.tier = 'FREE' THEN
        target_limit := 1;
      ELSE
        target_limit := v_tier.base_max_active - 1 + COALESCE(v_manager.additional_slots, 0);
      END IF;

      IF OLD.slot_no <= target_limit THEN
        UPDATE public.members 
        SET slot_no = OLD.slot_no,
            tier = CASE WHEN v_manager.tier = 'PRO' THEN 'PRO' ELSE 'FREE' END
        WHERE id = v_oldest_locked_member;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_manager_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_tier record;
  target_limit integer;
  i integer;
  v_oldest_locked_member uuid;
BEGIN
  -- If tier or additional_slots changed...
  IF (NEW.tier IS DISTINCT FROM OLD.tier) OR (NEW.additional_slots IS DISTINCT FROM OLD.additional_slots) THEN
    
    SELECT * INTO v_tier FROM public.tiers WHERE id = NEW.tier;
    
    IF NEW.tier = 'FREE' THEN
      target_limit := 1;
    ELSE
      target_limit := v_tier.base_max_active - 1 + COALESCE(NEW.additional_slots, 0);
    END IF;

    -- DOWNGRADE: Strip slots from members sitting in seats higher than the new target_limit
    UPDATE public.members 
    SET slot_no = NULL, tier = 'LOCKED'
    WHERE manager_id = NEW.id AND slot_no > target_limit;

    -- UPGRADE: Auto-fill any newly opened seats (from 1 to target_limit)
    FOR i IN 1..target_limit LOOP
      -- If seat `i` is empty...
      IF NOT EXISTS (SELECT 1 FROM public.members WHERE manager_id = NEW.id AND slot_no = i AND connection_status = 'CONNECTED') THEN
        -- Find oldest locked target
        SELECT id INTO v_oldest_locked_member
        FROM public.members
        WHERE manager_id = NEW.id 
          AND connection_status = 'CONNECTED'
          AND slot_no IS NULL
          AND LOWER(email) != LOWER(NEW.email)
        ORDER BY created_at ASC
        LIMIT 1;

        -- Promote them to seat `i`
        IF v_oldest_locked_member IS NOT NULL THEN
          UPDATE public.members 
          SET slot_no = i,
              tier = CASE WHEN NEW.tier = 'PRO' THEN 'PRO' ELSE 'FREE' END
          WHERE id = v_oldest_locked_member;
        END IF;
      END IF;
    END LOOP;

    -- Ensure remaining active members update their tier string (PRO vs FREE)
    UPDATE public.members 
    SET tier = CASE WHEN NEW.tier = 'PRO' THEN 'PRO' ELSE 'FREE' END
    WHERE manager_id = NEW.id AND slot_no IS NOT NULL;
    
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_member_tier_on_connect_exact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_manager record;
  v_tier record;
  is_self boolean;
  target_limit integer;
  available_slot integer;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- If member is disconnecting, lock them and free slot
  IF NEW.connection_status != 'CONNECTED' THEN
    NEW.slot_no := NULL;
    NEW.tier := 'LOCKED';
    RETURN NEW;
  END IF;

  SELECT * INTO v_manager FROM public.managers WHERE id = NEW.manager_id;
  SELECT * INTO v_tier FROM public.tiers WHERE id = v_manager.tier;
  
  is_self := LOWER(NEW.email) = LOWER(v_manager.email);

  IF is_self THEN
    IF v_manager.tier = 'FREE' THEN
      UPDATE public.managers SET tier = 'TRIAL' WHERE id = v_manager.id;
      v_manager.tier := 'TRIAL';
    END IF;
    NEW.tier := 'PRO';
    NEW.slot_no := 0;
  ELSE
    IF v_manager.tier = 'FREE' THEN
      target_limit := 1;
    ELSE
      target_limit := v_tier.base_max_active - 1 + COALESCE(v_manager.additional_slots, 0);
    END IF;

    IF NEW.slot_no IS NULL THEN
      SELECT s INTO available_slot
      FROM generate_series(1, target_limit) s
      WHERE NOT EXISTS (
        SELECT 1 FROM public.members 
        WHERE manager_id = NEW.manager_id 
          AND slot_no = s 
          AND connection_status = 'CONNECTED'
          AND id != NEW.id
      )
      ORDER BY s ASC LIMIT 1;

      IF available_slot IS NOT NULL THEN
        NEW.slot_no := available_slot;
        NEW.tier := CASE WHEN v_manager.tier = 'PRO' THEN 'PRO' ELSE 'FREE' END;
      ELSE
        NEW.slot_no := NULL;
        NEW.tier := 'LOCKED';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_manager_capacity(auth_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  found_manager record;
  found_tier record;
  max_allowed integer;
BEGIN
  SELECT * INTO found_manager FROM managers WHERE auth_id = auth_code;
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid Manager Auth ID. Please check the code and try again.');
  END IF;
  
  SELECT * INTO found_tier FROM tiers WHERE id = found_manager.tier;
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid Manager Tier configuration.');
  END IF;

  max_allowed := found_tier.base_max_total + COALESCE(found_manager.additional_slots, 0);

  IF found_manager.current_total_connections >= max_allowed THEN
    RETURN json_build_object('valid', false, 'error', 'This manager has reached their maximum connection limit.');
  END IF;

  RETURN json_build_object('valid', true, 'manager_id', found_manager.id);
END;
$function$
;

grant delete on table "public"."scan_executions" to "anon";

grant insert on table "public"."scan_executions" to "anon";

grant references on table "public"."scan_executions" to "anon";

grant select on table "public"."scan_executions" to "anon";

grant trigger on table "public"."scan_executions" to "anon";

grant truncate on table "public"."scan_executions" to "anon";

grant update on table "public"."scan_executions" to "anon";

grant delete on table "public"."scan_executions" to "authenticated";

grant insert on table "public"."scan_executions" to "authenticated";

grant references on table "public"."scan_executions" to "authenticated";

grant select on table "public"."scan_executions" to "authenticated";

grant trigger on table "public"."scan_executions" to "authenticated";

grant truncate on table "public"."scan_executions" to "authenticated";

grant update on table "public"."scan_executions" to "authenticated";

grant delete on table "public"."scan_executions" to "service_role";

grant insert on table "public"."scan_executions" to "service_role";

grant references on table "public"."scan_executions" to "service_role";

grant select on table "public"."scan_executions" to "service_role";

grant trigger on table "public"."scan_executions" to "service_role";

grant truncate on table "public"."scan_executions" to "service_role";

grant update on table "public"."scan_executions" to "service_role";

grant delete on table "public"."tiers" to "anon";

grant insert on table "public"."tiers" to "anon";

grant select on table "public"."tiers" to "anon";

grant update on table "public"."tiers" to "anon";

grant delete on table "public"."tiers" to "authenticated";

grant insert on table "public"."tiers" to "authenticated";

grant select on table "public"."tiers" to "authenticated";

grant update on table "public"."tiers" to "authenticated";

grant delete on table "public"."tiers" to "service_role";

grant insert on table "public"."tiers" to "service_role";

grant select on table "public"."tiers" to "service_role";

grant update on table "public"."tiers" to "service_role";


  create policy "Managers can view their own scan executions"
  on "public"."scan_executions"
  as permissive
  for select
  to public
using ((manager_id = ( SELECT managers.id
   FROM public.managers
  WHERE ((managers.auth_id)::text = (auth.uid())::text))));



  create policy "Tiers are viewable by everyone"
  on "public"."tiers"
  as permissive
  for select
  to public
using (true);


CREATE TRIGGER trg_handle_manager_tier_change AFTER UPDATE OF tier, additional_slots ON public.managers FOR EACH ROW EXECUTE FUNCTION public.handle_manager_tier_change();

CREATE TRIGGER trg_assign_member_tier_on_connect_exact BEFORE INSERT OR UPDATE OF connection_status ON public.members FOR EACH ROW EXECUTE FUNCTION public.assign_member_tier_on_connect_exact();

CREATE TRIGGER trg_cascade_member_slots AFTER UPDATE OF slot_no ON public.members FOR EACH ROW EXECUTE FUNCTION public.cascade_member_slots();


