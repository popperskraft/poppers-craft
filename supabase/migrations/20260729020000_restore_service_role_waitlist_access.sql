grant select, insert, update, delete
  on table public.waitlist_applications
  to service_role;

grant usage, select
  on sequence public.waitlist_applications_id_seq
  to service_role;
