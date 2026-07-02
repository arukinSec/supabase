drop extension if exists "pg_net";

drop policy "Enable read access for all users" on "public"."app_config";

revoke references on table "public"."app_config" from "anon";

revoke trigger on table "public"."app_config" from "anon";

revoke truncate on table "public"."app_config" from "anon";

revoke references on table "public"."app_config" from "authenticated";

revoke trigger on table "public"."app_config" from "authenticated";

revoke truncate on table "public"."app_config" from "authenticated";

revoke references on table "public"."app_config" from "service_role";

revoke trigger on table "public"."app_config" from "service_role";

revoke truncate on table "public"."app_config" from "service_role";

alter table "public"."app_config" drop constraint "app_config_pkey";

drop index if exists "public"."app_config_pkey";

drop table "public"."app_config";

alter table "public"."audit_logs" add column "performer_id" uuid;

alter table "public"."audit_logs" enable row level security;

alter table "public"."auditors" add column "additional_slots" integer not null default 0;

alter table "public"."auditors" add column "billing_cycle" character varying(50);

alter table "public"."auditors" add column "onboarded" boolean not null default false;

alter table "public"."auditors" add column "pro_expires_at" timestamp with time zone;

alter table "public"."auditors" add column "razorpay_customer_id" character varying(255);

alter table "public"."auditors" add column "razorpay_subscription_id" character varying(255);

alter table "public"."auditors" enable row level security;

alter table "public"."members" add column "connection_status" character varying(50) not null default 'CONNECTED'::character varying;

alter table "public"."members" add column "inputted_auth_id" character varying(100);

alter table "public"."members" enable row level security;

alter table "public"."audit_logs" add constraint "audit_logs_performer_id_fkey" FOREIGN KEY (performer_id) REFERENCES public.auditors(id) ON DELETE SET NULL not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_performer_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.increment_slots(auditor_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      BEGIN
        UPDATE auditors 
        SET additional_slots = additional_slots + 1 
        WHERE id = auditor_uuid;
        
        RETURN 'Congrats! You just got yourself a free pass. 🕵️‍♂️';
      END;
      $function$
;

CREATE OR REPLACE FUNCTION public.verify_auditor_capacity(auth_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      DECLARE
        found_auditor record;
        member_count int;
        max_allowed int;
      BEGIN
        SELECT id, tier, additional_slots INTO found_auditor FROM public.auditors WHERE auth_id = auth_code;
        
        IF NOT FOUND THEN
          RETURN json_build_object('valid', false, 'error', 'Invalid Auditor Auth ID. Please check the code and try again.');
        END IF;

        SELECT count(*) INTO member_count FROM public.members WHERE auditor_id = found_auditor.id AND connection_status = 'CONNECTED';
        
        IF found_auditor.tier = 'PRO' THEN
          max_allowed := 4 + COALESCE(found_auditor.additional_slots, 0);
        ELSE
          max_allowed := 3;
        END IF;

        IF member_count >= max_allowed THEN
          RETURN json_build_object('valid', false, 'error', 'This auditor has reached their maximum connection limit.');
        END IF;

        RETURN json_build_object('valid', true, 'auditor_id', found_auditor.id);
      END;
      $function$
;

grant delete on table "public"."audit_logs" to "anon";

grant insert on table "public"."audit_logs" to "anon";

grant select on table "public"."audit_logs" to "anon";

grant update on table "public"."audit_logs" to "anon";

grant delete on table "public"."audit_logs" to "authenticated";

grant insert on table "public"."audit_logs" to "authenticated";

grant select on table "public"."audit_logs" to "authenticated";

grant update on table "public"."audit_logs" to "authenticated";

grant delete on table "public"."audit_logs" to "service_role";

grant insert on table "public"."audit_logs" to "service_role";

grant select on table "public"."audit_logs" to "service_role";

grant update on table "public"."audit_logs" to "service_role";

grant delete on table "public"."auditors" to "anon";

grant insert on table "public"."auditors" to "anon";

grant select on table "public"."auditors" to "anon";

grant update on table "public"."auditors" to "anon";

grant delete on table "public"."auditors" to "authenticated";

grant insert on table "public"."auditors" to "authenticated";

grant select on table "public"."auditors" to "authenticated";

grant update on table "public"."auditors" to "authenticated";

grant delete on table "public"."auditors" to "service_role";

grant insert on table "public"."auditors" to "service_role";

grant select on table "public"."auditors" to "service_role";

grant update on table "public"."auditors" to "service_role";

grant delete on table "public"."members" to "anon";

grant insert on table "public"."members" to "anon";

grant select on table "public"."members" to "anon";

grant update on table "public"."members" to "anon";

grant delete on table "public"."members" to "authenticated";

grant insert on table "public"."members" to "authenticated";

grant select on table "public"."members" to "authenticated";

grant update on table "public"."members" to "authenticated";

grant delete on table "public"."members" to "service_role";

grant insert on table "public"."members" to "service_role";

grant select on table "public"."members" to "service_role";

grant update on table "public"."members" to "service_role";


  create policy "Auditors can manage audit logs"
  on "public"."audit_logs"
  as permissive
  for all
  to public
using ((auditor_id IN ( SELECT auditors.id
   FROM public.auditors
  WHERE ((auditors.email)::text = (auth.jwt() ->> 'email'::text)))));



  create policy "Auditors can manage their own profile"
  on "public"."auditors"
  as permissive
  for all
  to public
using (((email)::text = (auth.jwt() ->> 'email'::text)))
with check (((email)::text = (auth.jwt() ->> 'email'::text)));



  create policy "Auditors can view and manage their connected members"
  on "public"."members"
  as permissive
  for all
  to public
using ((auditor_id IN ( SELECT auditors.id
   FROM public.auditors
  WHERE ((auditors.email)::text = (auth.jwt() ->> 'email'::text)))));



  create policy "Members can manage their own connection"
  on "public"."members"
  as permissive
  for all
  to public
using (((email)::text = (auth.jwt() ->> 'email'::text)))
with check (((email)::text = (auth.jwt() ->> 'email'::text)));



