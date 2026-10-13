-- Van Schalkwyk Holdings: shared product database and single master admin.
-- Run in your OWN Supabase project's SQL Editor. Do not place secrets in GitHub.
-- Do not run these statements against an existing differently structured schema.
--
-- 1) Create an Auth user manually in Supabase Authentication > Users.
-- 2) Run this schema.
-- 3) Add their UUID to public.admin_users using the command at the very bottom.
--
-- This schema deliberately DOES NOT implement payments, PDF distribution or orders.

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'master' check (role = 'master'),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business text not null check (business in ('grannys','clever-cubs')),
  title text not null check (length(btrim(title)) between 1 and 120),
  category text not null check (length(btrim(category)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  grade text not null default '' check (length(grade) <= 80),
  price numeric(10,2) not null check (price >= 0),
  image_path text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_business_updated_idx on public.products (business, updated_at desc);
create index if not exists products_business_active_idx on public.products (business, is_active);

create or replace function public.vsh_set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists vsh_products_updated_at on public.products;
create trigger vsh_products_updated_at
before update on public.products for each row execute function public.vsh_set_updated_at();

alter table public.admin_users enable row level security;
alter table public.products enable row level security;

revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;
grant select on public.products to anon, authenticated;
grant insert, update on public.products to authenticated;
revoke delete on public.products from anon, authenticated;

drop policy if exists "Master admin can read own role" on public.admin_users;
create policy "Master admin can read own role" on public.admin_users
for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Public can read published products" on public.products;
create policy "Public can read published products" on public.products
for select to anon, authenticated using (is_active = true);

drop policy if exists "Master admin can read all products" on public.products;
create policy "Master admin can read all products" on public.products
for select to authenticated
using (exists (select 1 from public.admin_users a where a.id = (select auth.uid()) and a.role = 'master'));

drop policy if exists "Master admin can create products" on public.products;
create policy "Master admin can create products" on public.products
for insert to authenticated
with check (exists (select 1 from public.admin_users a where a.id = (select auth.uid()) and a.role = 'master'));

drop policy if exists "Master admin can update products" on public.products;
create policy "Master admin can update products" on public.products
for update to authenticated
using (exists (select 1 from public.admin_users a where a.id = (select auth.uid()) and a.role = 'master'))
with check (exists (select 1 from public.admin_users a where a.id = (select auth.uid()) and a.role = 'master'));

-- Only product PHOTOGRAPHS are public. Never upload private or paid book PDFs here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',true,5242880,ARRAY['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
 public = excluded.public,
 file_size_limit = excluded.file_size_limit,
 allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Master admin uploads product images" on storage.objects;
create policy "Master admin uploads product images" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] in ('grannys','clever-cubs')
  and exists (select 1 from public.admin_users a where a.id = (select auth.uid()) and a.role = 'master')
);

-- Add the single master login AFTER creating its Supabase Auth user.
-- Replace the address before running; do not commit your real email/password.
--
-- insert into public.admin_users (id, role)
-- select id, 'master' from auth.users
-- where lower(email) = lower('YOUR-ADMIN-EMAIL@example.com')
-- on conflict (id) do update set role = excluded.role;
