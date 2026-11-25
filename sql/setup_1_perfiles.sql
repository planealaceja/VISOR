-- ¿No sabes cómo se llaman tus tablas? Ejecuta primero esta consulta:
-- select table_schema, table_name from information_schema.tables
--  where table_name ilike any (array['%urbano%','%rural%','%resultado%']);

-- PARTE 1 · Roles y perfiles (no toca tus tablas de predios). Ejecutar UNA vez en Supabase → SQL Editor.
create table if not exists public.perfiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text,
  rol text not null default 'consulta' check (rol in ('admin','editor','consulta')),
  activo boolean not null default false,
  creado timestamptz default now()
);
alter table public.perfiles enable row level security;

create or replace function public.mi_rol() returns text
language sql security definer stable set search_path = public
as $$ select rol from public.perfiles where id = auth.uid() and activo $$;

drop policy if exists perfil_leer on public.perfiles;
create policy perfil_leer on public.perfiles for select using (id = auth.uid() or public.mi_rol() = 'admin');
drop policy if exists perfil_admin on public.perfiles;
create policy perfil_admin on public.perfiles for update using (public.mi_rol() = 'admin');

-- Cada usuario nuevo de Authentication queda con perfil INACTIVO hasta que un admin lo active
create or replace function public.nuevo_perfil() returns trigger
language plpgsql security definer set search_path = public
as $$ begin insert into public.perfiles(id, nombre) values (new.id, split_part(new.email,'@',1)); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.nuevo_perfil();

-- Hazte administrador (cambia el correo). Funciona aunque el usuario ya existiera antes del trigger:
insert into public.perfiles(id, nombre, rol, activo)
select id, split_part(email,'@',1), 'admin', true from auth.users where email = 'tu@correo.com'
on conflict (id) do update set rol = 'admin', activo = true;
