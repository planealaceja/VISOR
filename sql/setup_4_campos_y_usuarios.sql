-- PARTE 4 · Configuración de campos, edición de campos creados y correo en perfiles.
-- Ejecutar después de las partes 1, 2 y 3.
alter table public.perfiles add column if not exists email text;
update public.perfiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
create or replace function public.nuevo_perfil() returns trigger
language plpgsql security definer set search_path = public
as $$ begin insert into public.perfiles(id, nombre, email) values (new.id, split_part(new.email,'@',1), new.email); return new; end $$;

-- Qué campos se ven en Predios y cuáles fueron creados desde el panel (solo esos se pueden renombrar/borrar)
create table if not exists public.campos_config (
  tabla text not null, columna text not null,
  visible boolean not null default true, creado boolean not null default false,
  primary key (tabla, columna)
);
alter table public.campos_config enable row level security;
drop policy if exists cc_leer on public.campos_config;
create policy cc_leer on public.campos_config for select to authenticated using (true);
drop policy if exists cc_admin on public.campos_config;
create policy cc_admin on public.campos_config for all to authenticated
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

create or replace function public.agregar_columna(p_tabla text, p_nombre text, p_tipo text)
returns text language plpgsql security definer set search_path = public
as $$
declare v_tipo text;
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo un administrador puede crear campos'; end if;
  if p_tabla not in ('urbano','Rural') then raise exception 'Tabla no permitida'; end if;
  if p_nombre !~ '^[a-z][a-z0-9_]{0,40}$' then raise exception 'Nombre de campo no válido'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name=p_tabla and column_name=p_nombre)
    then raise exception 'El campo % ya existe en %', p_nombre, p_tabla; end if;
  v_tipo := case p_tipo when 'texto' then 'text' when 'numero' then 'numeric' when 'entero' then 'integer'
                        when 'fecha' then 'date' when 'booleano' then 'boolean' end;
  if v_tipo is null then raise exception 'Tipo no permitido'; end if;
  execute format('alter table public.%I add column %I %s', p_tabla, p_nombre, v_tipo);
  insert into public.campos_config(tabla, columna, creado) values (p_tabla, p_nombre, true)
    on conflict (tabla, columna) do update set creado = true;
  notify pgrst, 'reload schema';
  return 'ok';
end $$;

create or replace function public.renombrar_columna(p_tabla text, p_viejo text, p_nuevo text)
returns text language plpgsql security definer set search_path = public
as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo un administrador'; end if;
  if p_nuevo !~ '^[a-z][a-z0-9_]{0,40}$' then raise exception 'Nombre no válido'; end if;
  if not exists (select 1 from public.campos_config where tabla=p_tabla and columna=p_viejo and creado)
    then raise exception 'Solo se pueden modificar campos creados desde el panel'; end if;
  execute format('alter table public.%I rename column %I to %I', p_tabla, p_viejo, p_nuevo);
  update public.campos_config set columna = p_nuevo where tabla = p_tabla and columna = p_viejo;
  notify pgrst, 'reload schema';
  return 'ok';
end $$;

create or replace function public.eliminar_columna(p_tabla text, p_nombre text)
returns text language plpgsql security definer set search_path = public
as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo un administrador'; end if;
  if not exists (select 1 from public.campos_config where tabla=p_tabla and columna=p_nombre and creado)
    then raise exception 'Solo se pueden eliminar campos creados desde el panel'; end if;
  execute format('alter table public.%I drop column %I', p_tabla, p_nombre);
  delete from public.campos_config where tabla = p_tabla and columna = p_nombre;
  notify pgrst, 'reload schema';
  return 'ok';
end $$;

revoke all on function public.renombrar_columna(text,text,text) from public, anon;
revoke all on function public.eliminar_columna(text,text) from public, anon;
grant execute on function public.renombrar_columna(text,text,text) to authenticated;
grant execute on function public.eliminar_columna(text,text) to authenticated;
