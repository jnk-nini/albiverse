-- Run this once in the Supabase SQL Editor for the project used by .env.local.

grant usage on schema public to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.couples to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_select_linked_partner" on public.profiles;
create policy "profiles_select_linked_partner"
on public.profiles
for select
to authenticated
using (
	exists (
		select 1
		from public.couples
		where id = profiles.couple_id
			and ((select auth.uid()) = partner_1_id or (select auth.uid()) = partner_2_id)
	)
);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "profiles_unlink_participant" on public.profiles;
create policy "profiles_unlink_participant"
on public.profiles
for update
to authenticated
using (
	exists (
		select 1
		from public.couples
		where id = profiles.couple_id
			and ((select auth.uid()) = partner_1_id or (select auth.uid()) = partner_2_id)
	)
)
with check (couple_id is null);

alter table public.couples enable row level security;

drop policy if exists "couples_insert_participant" on public.couples;
create policy "couples_insert_participant"
on public.couples
for insert
to authenticated
with check (
	(select auth.uid()) = partner_1_id
	or (select auth.uid()) = partner_2_id
);

drop policy if exists "couples_select_participant" on public.couples;
create policy "couples_select_participant"
on public.couples
for select
to authenticated
using (
	(select auth.uid()) = partner_1_id
	or (select auth.uid()) = partner_2_id
);

drop policy if exists "couples_update_participant" on public.couples;
create policy "couples_update_participant"
on public.couples
for update
to authenticated
using (
	(select auth.uid()) = partner_1_id
	or (select auth.uid()) = partner_2_id
)
with check (
	(select auth.uid()) = partner_1_id
	or (select auth.uid()) = partner_2_id
);

drop policy if exists "couples_delete_participant" on public.couples;
create policy "couples_delete_participant"
on public.couples
for delete
to authenticated
using (
	(select auth.uid()) = partner_1_id
	or (select auth.uid()) = partner_2_id
);