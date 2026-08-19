-- Albiverse shared feature foundation.
-- Run this migration in the Supabase SQL Editor after the existing profiles/couples policies.

create extension if not exists pgcrypto;

create table if not exists public.shared_diary (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  mood text,
  location text,
  weather text,
  media_urls text[] not null default '{}',
  audio_url text,
  song_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  media_type text not null check (media_type in ('image', 'video', 'audio')),
  caption text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null default '',
  theme_style text not null default 'parchment',
  qr_code_url text,
  is_private boolean not null default false,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  reminder_at timestamptz,
  rsvp_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bucket_list (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Crazy Ideas',
  is_completed boolean not null default false,
  photo_proof_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_vault (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid references auth.users(id) on delete set null,
  section_type text not null,
  key_name text not null,
  content_json jsonb not null default '{}'::jsonb,
  media_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_couple_member(target_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couples c
    where c.id = target_couple_id
      and (select auth.uid()) in (c.partner_1_id, c.partner_2_id)
  );
$$;

grant execute on function public.is_couple_member(uuid) to authenticated;

grant select, insert, update, delete on table public.shared_diary, public.media_items, public.letters, public.calendar_events, public.bucket_list to authenticated;
grant select, insert, update, delete on table public.partner_vault to authenticated;

alter table public.shared_diary enable row level security;
alter table public.media_items enable row level security;
alter table public.letters enable row level security;
alter table public.calendar_events enable row level security;
alter table public.bucket_list enable row level security;
alter table public.partner_vault enable row level security;

create policy "shared_diary_member_read_update_delete" on public.shared_diary for select to authenticated
using (public.is_couple_member(couple_id));
create policy "shared_diary_member_insert" on public.shared_diary for insert to authenticated
with check (public.is_couple_member(couple_id) and (select auth.uid()) = author_id);
create policy "shared_diary_member_update_delete" on public.shared_diary for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));
create policy "shared_diary_member_delete" on public.shared_diary for delete to authenticated
using (public.is_couple_member(couple_id));

create policy "media_items_member_read" on public.media_items for select to authenticated
using (public.is_couple_member(couple_id));
create policy "media_items_member_insert" on public.media_items for insert to authenticated
with check (public.is_couple_member(couple_id) and (select auth.uid()) = uploader_id);
create policy "media_items_member_update" on public.media_items for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));
create policy "media_items_member_delete" on public.media_items for delete to authenticated
using (public.is_couple_member(couple_id));

create policy "letters_member_access" on public.letters for all to authenticated
using (
  public.is_couple_member(couple_id)
  and ((not is_private) or (select auth.uid()) = sender_id)
)
with check (
  public.is_couple_member(couple_id)
  and (select auth.uid()) = sender_id
);

create policy "calendar_events_member_read" on public.calendar_events for select to authenticated
using (public.is_couple_member(couple_id));
create policy "calendar_events_member_insert" on public.calendar_events for insert to authenticated
with check (public.is_couple_member(couple_id) and (select auth.uid()) = creator_id);
create policy "calendar_events_member_update" on public.calendar_events for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));
create policy "calendar_events_member_delete" on public.calendar_events for delete to authenticated
using (public.is_couple_member(couple_id));

create policy "bucket_list_member_read" on public.bucket_list for select to authenticated
using (public.is_couple_member(couple_id));
create policy "bucket_list_member_insert" on public.bucket_list for insert to authenticated
with check (public.is_couple_member(couple_id) and (select auth.uid()) = creator_id);
create policy "bucket_list_member_update" on public.bucket_list for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));
create policy "bucket_list_member_delete" on public.bucket_list for delete to authenticated
using (public.is_couple_member(couple_id));

create policy "partner_vault_owner_access" on public.partner_vault for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create index if not exists shared_diary_couple_idx on public.shared_diary(couple_id, created_at desc);
create index if not exists media_items_couple_idx on public.media_items(couple_id, created_at desc);
create index if not exists letters_couple_idx on public.letters(couple_id, created_at desc);
create index if not exists calendar_events_couple_idx on public.calendar_events(couple_id, starts_at);
create index if not exists bucket_list_couple_idx on public.bucket_list(couple_id, created_at desc);
create index if not exists partner_vault_owner_idx on public.partner_vault(owner_id, updated_at desc);
