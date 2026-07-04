drop trigger if exists "trg_update_members_tier" on "public"."auditors";

drop trigger if exists "trg_assign_member_tier" on "public"."members";

drop policy "Auditors can manage audit logs" on "public"."audit_logs";

drop policy "Auditors can view and manage their connected members" on "public"."members";

alter table "public"."audit_logs" drop constraint "audit_logs_auditor_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_member_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_performer_id_fkey";

alter table "public"."members" drop constraint "members_auditor_id_fkey";

alter table "public"."usage_logs" drop constraint "usage_logs_member_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_auditor_id_fkey" FOREIGN KEY (auditor_id) REFERENCES public.auditors(id) not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_auditor_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_member_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_performer_id_fkey" FOREIGN KEY (performer_id) REFERENCES public.auditors(id) ON DELETE SET NULL not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_performer_id_fkey";

alter table "public"."members" add constraint "members_auditor_id_fkey" FOREIGN KEY (auditor_id) REFERENCES public.auditors(id) ON DELETE SET NULL not valid;

alter table "public"."members" validate constraint "members_auditor_id_fkey";

alter table "public"."usage_logs" add constraint "usage_logs_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."usage_logs" validate constraint "usage_logs_member_id_fkey";


  create policy "Auditors can manage audit logs"
  on "public"."audit_logs"
  as permissive
  for all
  to public
using ((auditor_id IN ( SELECT auditors.id
   FROM public.auditors
  WHERE ((auditors.email)::text = (auth.jwt() ->> 'email'::text)))));



  create policy "Auditors can view and manage their connected members"
  on "public"."members"
  as permissive
  for all
  to public
using ((auditor_id IN ( SELECT auditors.id
   FROM public.auditors
  WHERE ((auditors.email)::text = (auth.jwt() ->> 'email'::text)))));





