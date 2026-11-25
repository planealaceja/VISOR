# Geo-Ceja · estructura

```
index.html        Visor (el botón azul del usuario, junto a la búsqueda, lleva a admin/)
css/visor.css     Estilos del visor      js/visor.js   Lógica del visor
js/config.js      Credenciales Supabase (compartidas por visor y administración)
admin/            Login + panel administrativo (index.html, admin.css, admin.js)
sql/setup_admin.sql   Roles y permisos en Supabase
logo.png          Colócalo junto a index.html (ya lo usabas)
```
## Puesta en marcha
1. Supabase → SQL Editor: ejecuta `sql/setup_admin.sql`.
2. Authentication → Users: crea tu usuario; ejecuta la línea final del SQL para volverlo admin.
3. Sube la carpeta completa al hosting. Entra por el botón de usuario del visor.

## Roles
- **admin**: todo, incluida la gestión de usuarios.  **editor**: predios, carga e informes.  **consulta**: solo informes.
- Usuarios nuevos: créalos en Authentication; quedan inactivos hasta que el admin los active y les asigne rol.

## Importante
- El SQL activa seguridad por filas en `urbano`, `Rural` y las dos tablas de usos: la lectura pública del visor se conserva y solo admin/editor pueden escribir. Haz copia de la base antes de ejecutarlo.
- La carga de geometrías (`geom`) envía GeoJSON/WKT como texto; pruébala primero con 2 o 3 predios.
