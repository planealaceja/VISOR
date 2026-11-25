-- PARTE 2 · Permisos de las tablas de predios. Ejecutar DESPUÉS de la parte 1.
-- Tablas del visor: lectura pública (como hoy) y escritura solo admin/editor
do $$ declare t text; begin
  foreach t in array array['urbano','Rural','resultado_uso_predio','resultado_uso_predio_rural'] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Tabla % no encontrada en public: se omite (revisa su nombre real)', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lectura_publica on public.%I', t);
    execute format('create policy lectura_publica on public.%I for select using (true)', t);
    execute format('drop policy if exists escritura_staff on public.%I', t);
    execute format($p$create policy escritura_staff on public.%I for all to authenticated
      using (public.mi_rol() in ('admin','editor')) with check (public.mi_rol() in ('admin','editor'))$p$, t);
  end loop;
end $$;

