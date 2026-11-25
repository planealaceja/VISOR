-- PARTE 3 · Campos dinámicos. Ejecutar después de las partes 1 y 2.
-- Permite listar las columnas reales de urbano/Rural y que un ADMIN cree columnas nuevas.
create or replace function public.listar_columnas(p_tabla text)
returns table(column_name text, data_type text)
language sql security definer stable set search_path = public
as $$
  select c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_tabla and p_tabla in ('urbano','Rural')
  order by c.ordinal_position
$$;

create or replace function public.agregar_columna(p_tabla text, p_nombre text, p_tipo text)
returns text language plpgsql security definer set search_path = public
as $$
declare v_tipo text;
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo un administrador puede crear campos'; end if;
  if p_tabla not in ('urbano','Rural') then raise exception 'Tabla no permitida'; end if;
  if p_nombre !~ '^[a-z][a-z0-9_]{0,40}$' then raise exception 'Nombre de campo no válido'; end if;
  v_tipo := case p_tipo when 'texto' then 'text' when 'numero' then 'numeric' when 'entero' then 'integer'
                        when 'fecha' then 'date' when 'booleano' then 'boolean' end;
  if v_tipo is null then raise exception 'Tipo no permitido'; end if;
  execute format('alter table public.%I add column if not exists %I %s', p_tabla, p_nombre, v_tipo);
  notify pgrst, 'reload schema';   -- para que la API vea el campo nuevo de inmediato
  return 'ok';
end $$;

revoke all on function public.listar_columnas(text) from public, anon;
revoke all on function public.agregar_columna(text,text,text) from public, anon;
grant execute on function public.listar_columnas(text) to authenticated;
grant execute on function public.agregar_columna(text,text,text) to authenticated;
