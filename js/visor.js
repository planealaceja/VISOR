
// ── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// 🔧 Solo reemplaza estos dos valores con los de tu proyecto Supabase:
// (SUPABASE_URL y SUPABASE_ANON_KEY ahora están en js/config.js)
// ────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ESTRUCTURA REAL DE SUPABASE:
//
// URBANO:
//   · matricula está en tabla "urbano" (columna: matricula, id)
//   · usos del suelo en "resultado_uso_predio" (columna: predio_id, tipo_suelo, area_m2, porcentaje, geom WKB)
//   · geom está en "resultado_uso_predio" — se une por urbano.id = resultado_uso_predio.predio_id
//
// RURAL:
//   · matricula + usos en "resultado_uso_predio_rural" (columna: matricula, predio_id, tipo_suelo, area_m2, porcentaje)
//   · geom está en "Rural" — se une por resultado_uso_predio_rural.predio_id = Rural.id
// ─────────────────────────────────────────────────────────────────────────────

let predioLayer   = null;
let predioGeojson = null;
let predioData    = {};  // datos del predio para el PDF

// ── Abrir / cerrar modal ──
function abrirBusquedaMatricula() {
  document.getElementById('matricula-overlay').classList.add('open');
  setTimeout(() => document.getElementById('matricula-input').focus(), 80);
}
function cerrarModalMatricula(e) {
  if (e && e.target !== document.getElementById('matricula-overlay')) return;
  document.getElementById('matricula-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('matricula-overlay').classList.remove('open');
});

  // ── Abrir / cerrar modal de Ayuda ──
  function abrirModalAyuda() {
    document.getElementById('ayuda-overlay').classList.add('open');
  }
  function cerrarModalAyuda(e) {
    if (e && e.target !== document.getElementById('ayuda-overlay')) return;
    document.getElementById('ayuda-overlay').classList.remove('open');
  }

  // Escuchar la tecla "Escape" para cerrar este modal también
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('ayuda-overlay').classList.remove('open');
    }
  });

// ── Búsqueda principal ──
async function buscarPorMatricula() {
  const matricula = document.getElementById('matricula-input').value.trim();
  if (!matricula) { mostrarErrorMatricula('Por favor ingresa un número de matrícula.'); return; }

  if (SUPABASE_URL.includes('TU_PROYECTO') || SUPABASE_ANON_KEY.includes('TU_ANON_KEY')) {
    mostrarErrorMatricula('⚠️ Debes configurar SUPABASE_URL y SUPABASE_ANON_KEY en el código antes de usar esta función.');
    return;
  }

  ocultarResultado();
  document.getElementById('matricula-spinner').style.display = 'block';
  document.getElementById('btn-buscar-matricula').disabled = true;
  predioGeojson = null;

  try {
    // ── URBANO ──
    // 1a. Buscar el id del predio en tabla "urbano" por matrícula
    const urbanoReg = await sbFetch(`urbano?matricula=eq.${encodeURIComponent(matricula)}&select=id&limit=1`);

    if (urbanoReg && urbanoReg.length > 0) {
      const predioId = urbanoReg[0].id;
      // 1b. Traer usos del suelo
      const usos = await sbFetch(`resultado_uso_predio?predio_id=eq.${predioId}&order=porcentaje.desc`);
      if (!usos || usos.length === 0) {
        mostrarErrorMatricula(`Predio urbano encontrado pero sin usos de suelo registrados.`);
        return;
      }
      // 1c. Traer datos completos del predio para el PDF
      const datosUrb = await sbFetch(`urbano?id=eq.${predioId}&select=matricula,nup,primer_ape,segundo_ap,area_terr,ficha,direccion&limit=1`);
      predioData = datosUrb ? datosUrb[0] : {};
      predioData._tipo = 'Urbano';
      // 1d. Geometría — corregir coordenadas invertidas
      predioGeojson = await fetchGeomDesdeResultadoUrbano(predioId);
      mostrarUsosPredi(matricula, usos, false);
      return;
    }

    // ── RURAL ──
    const usosRural = await sbFetch(`resultado_uso_predio_rural?matricula=eq.${encodeURIComponent(matricula)}&order=porcentaje.desc`);

    if (usosRural && usosRural.length > 0) {
      const predioId = usosRural[0].predio_id;
      // Traer datos completos desde Rural
      const datosRural = await sbFetch(`Rural?id=eq.${predioId}&select=matricula,nup,primer_ape,segundo_ap,area_terr,ficha,direccion&limit=1`);
      predioData = datosRural ? datosRural[0] : {};
      predioData._tipo = 'Rural';
      // Geometría Rural
      predioGeojson = await fetchGeomDesdeRural(predioId);
      mostrarUsosPredi(matricula, usosRural, true);
      return;
    }

    // No encontrado en ninguna tabla
    mostrarErrorMatricula(`No se encontró ningún predio con matrícula <strong>${matricula}</strong>.`);

  } catch (err) {
    mostrarErrorMatricula('Error al conectar con Supabase: ' + err.message);
  } finally {
    document.getElementById('matricula-spinner').style.display = 'none';
    document.getElementById('btn-buscar-matricula').disabled = false;
  }
}

// Helper base para fetch a Supabase REST API
async function sbFetch(endpoint) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en /${endpoint}`);
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data : null;
}

// Corrige coordenadas si están en orden X,Y (lng,lat) cuando deberían ser lat,lng
// PostGIS con SRID 4326 devuelve [lng, lat] que es lo correcto para GeoJSON — pero si el
// dato original fue cargado con las coordenadas invertidas, necesitamos flipearlas.
// Detectamos: si la primera coordenada X > 0 y Y < 0 estamos en Colombia → están invertidas
function corregirCoordenadas(geojson) {
  if (!geojson) return null;
  function flipCoord(c) {
    // Colombia: lat entre 4 y 8, lng entre -77 y -72
    // Si llegan como [lat, lng] → x~6, y~-75 → x es positivo pequeño, y negativo
    // Si llegan correctos [lng, lat] → x~-75, y~6 → x negativo, y positivo pequeño
    // Detectar: si abs(x) < 20 && y < -20 → están invertidos
    if (Math.abs(c[0]) < 20 && c[1] < -20) return [c[1], c[0]];
    return c;
  }
  function flipRing(ring) { return ring.map(flipCoord); }
  function flipGeom(g) {
    if (!g) return g;
    if (g.type === 'Point') return {...g, coordinates: flipCoord(g.coordinates)};
    if (g.type === 'LineString') return {...g, coordinates: g.coordinates.map(flipCoord)};
    if (g.type === 'Polygon') return {...g, coordinates: g.coordinates.map(flipRing)};
    if (g.type === 'MultiPolygon') return {...g, coordinates: g.coordinates.map(poly => poly.map(flipRing))};
    if (g.type === 'MultiLineString') return {...g, coordinates: g.coordinates.map(flipRing)};
    return g;
  }
  return flipGeom(geojson);
}

  async function fetchGeomDesdeResultadoUrbano(predioId) {
    // 1. Quitamos el "&limit=1" de la URL para traer TODOS los pedazos del predio
    const url = `${SUPABASE_URL}/rest/v1/resultado_uso_predio?predio_id=eq.${predioId}&select=geom`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Accept': 'application/geo+json'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (data.type === 'FeatureCollection' && data.features && data.features.length > 0) {
      // 2. En lugar de devolver solo el [0], corregimos las coordenadas de TODOS los pedazos
      data.features.forEach(feature => {
        feature.geometry = corregirCoordenadas(feature.geometry);
      });
      // 3. Devolvemos la colección completa. Leaflet se encargará de dibujar todos los pedazos juntos.
      return data;
    }
    return null;
  }

  async function fetchGeomDesdeRural(predioId) {
    // 1. Quitamos el "&limit=1" de la URL para traer TODOS los pedazos del predio rural
    const url = `${SUPABASE_URL}/rest/v1/Rural?id=eq.${predioId}&select=geom`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Accept': 'application/geo+json'
      }
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.type === 'FeatureCollection' && data.features && data.features.length > 0) {
      // 2. En lugar de devolver solo el [0], corregimos las coordenadas de TODOS los pedazos
      data.features.forEach(feature => {
        feature.geometry = corregirCoordenadas(feature.geometry);
      });
      // 3. Devolvemos la colección completa. Leaflet se encargará de dibujar todos los pedazos juntos.
      return data;
    }

    return null;
  }

// ── Renderizar tabla de usos del suelo ──
function mostrarUsosPredi(matricula, usos, esRural) {
  document.getElementById('matricula-error').style.display = 'none';

  const tipo = esRural ? '🌾 Rural' : '🏙 Urbano';
  document.getElementById('matricula-result-titulo').innerHTML =
    `${tipo} &nbsp;·&nbsp; Matrícula <strong>${matricula}</strong>`;

  const tbody = document.getElementById('usos-tbody');
  tbody.innerHTML = '';

  usos.forEach(u => {
    const pct = parseFloat(u.porcentaje) || 0;
    const area = u.area_m2 != null ? Number(u.area_m2).toLocaleString('es-CO', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
    const barW = Math.min(Math.round(pct), 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="uso-badge">${u.tipo_suelo || '—'}</span></td>
      <td>${u.descripcion || '—'}</td>
      <td style="text-align:right">${area}</td>
      <td>
        <div class="pct-bar-wrap">
          <div class="pct-bar" style="width:${barW}px"></div>
          <span style="font-size:11px;color:#555;white-space:nowrap">${pct.toFixed(1)}%</span>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('matricula-result').style.display = 'block';

  if (!predioGeojson) {
    document.getElementById('btn-ir-predio').style.display = 'block';
    document.getElementById('btn-ir-predio').textContent = '⚠️ Geometría no disponible';
    document.getElementById('btn-ir-predio').disabled = true;
    document.getElementById('btn-descargar-pdf').style.display = 'none';
  } else {
    document.getElementById('btn-ir-predio').disabled = false;
    document.getElementById('btn-ir-predio').style.display = 'block';
    document.getElementById('btn-ir-predio').textContent = '📍 Ver figura catastral en el mapa';
    document.getElementById('btn-descargar-pdf').style.display = 'flex';
  }
}

// ── Parsear geometría ──
function parsearGeometria(geom) {
  if (!geom) return null;
  if (typeof geom === 'object') return geom;
  if (typeof geom === 'string') {
    try { return JSON.parse(geom); } catch(e) {}
  }
  return null;
}

// ── Ir al predio en el mapa ──
function irAlPredioBuscado() {
  if (!predioGeojson) return;
  if (predioLayer) { map.removeLayer(predioLayer); predioLayer = null; }

  predioLayer = L.geoJSON(predioGeojson, {
    style: { color: '#00b4c8', weight: 3, fillColor: '#00b4c8', fillOpacity: 0.3 },
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 11, fillColor: '#00b4c8', color: '#fff', weight: 3, fillOpacity: 0.9 })
  }).addTo(map);

  const bounds = predioLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 19 });
  }

  document.getElementById('matricula-overlay').classList.remove('open');
  showToast('✅ Figura catastral localizada en el mapa');
}

// ── Helpers ──
function mostrarErrorMatricula(msg) {
  const el = document.getElementById('matricula-error');
  el.innerHTML = msg; el.style.display = 'block';
  document.getElementById('matricula-result').style.display = 'none';
}
function ocultarResultado() {
  document.getElementById('matricula-error').style.display = 'none';
  document.getElementById('matricula-result').style.display = 'none';
  document.getElementById('btn-descargar-pdf').style.display = 'none';
}

// ── Toggle panel derecho ──
let panelVisible = true;
function toggleRightPanel() {
  panelVisible = !panelVisible;
  const panel  = document.getElementById('right-panel');
  const toggle = document.getElementById('panel-toggle');
  const mapEl  = document.getElementById('map');
  panel.classList.toggle('collapsed', !panelVisible);
  toggle.classList.toggle('collapsed', !panelVisible);
  mapEl.classList.toggle('expanded', !panelVisible);
  // Actualizar posición del botón toggle
  toggle.style.right = panelVisible ? 'var(--panel-w)' : '0';
  // Forzar redibujado del mapa
  setTimeout(() => map.invalidateSize(), 320);
}

// ── Descarga de informe PDF ──
// 🔧 Configura el enlace y texto del pie del informe PDF:
const LINK_NORMA_URL   = 'https://www.colombiaot.gov.co/pot/buscador.html?&u=05376&representacion=&tipo=&tags=&dimension=&componente=&year=&pot=';  // ← reemplaza con tu URL
const LINK_NORMA_TEXTO = 'Consultar información adicional';  // ← texto del enlace

async function descargarInformePDF() {
  const titulo = document.getElementById('matricula-result-titulo').textContent;
  const btn = document.getElementById('btn-descargar-pdf');
  btn.textContent = '⏳ Generando PDF…';
  btn.disabled = true;

  try {
    // Asegurar que el polígono esté visible en el mapa antes de capturar
    if (predioGeojson && !predioLayer) {
      predioLayer = L.geoJSON(predioGeojson, {
        style: { color: '#00b4c8', weight: 3, fillColor: '#00b4c8', fillOpacity: 0.3 }
      }).addTo(map);
    }
    if (predioLayer) {
      const bounds = predioLayer.getBounds();
      // <-- NUEVO: Agregamos animate: false para que el encuadre sea instantáneo y no haya desfase
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 19, animate: false });
    }
    // Esperar a que el mapa y las tiles terminen de cargar
    await new Promise(resolve => {
      if (map._loaded) {
        map.once('idle', resolve);
        setTimeout(resolve, 2500); // fallback por si idle no dispara
      } else {
        setTimeout(resolve, 2500);
      }
    });

    // Capturar snapshot del mapa como imagen
    let mapImgDataUrl = null;
    try {
      const mapEl = document.getElementById('map');
      const canvas = await html2canvas(mapEl, {
        useCORS: true,
        allowTaint: false,
        scale: 2,
        logging: false,
        imageTimeout: 15000,
        foreignObjectRendering: false,
        onclone: (doc) => {
          // Asegurar que el canvas del mapa de Leaflet sea visible en el clon
          const clonedMap = doc.getElementById('map');
          if (clonedMap) clonedMap.style.visibility = 'visible';
        }
      });
      mapImgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    } catch(e) { console.warn('No se pudo capturar el mapa:', e); }

    // Recoger filas de la tabla de usos
    const rows = [];
    document.querySelectorAll('#usos-tbody tr').forEach(tr => {
      const celdas = tr.querySelectorAll('td');
      if (celdas.length >= 3) {
        rows.push({
          tipo:  celdas[0].textContent.trim(),
          desc:  celdas[1].textContent.trim(),
          area:  celdas[2].textContent.trim(),
          pct:   celdas[3] ? celdas[3].textContent.trim() : ''
        });
      }
    });

    // Datos del predio para la ficha
    const d = predioData || {};
    const areaCat = d.area_terr ? Number(d.area_terr).toLocaleString('es-CO', {minimumFractionDigits: 2}) + ' m²' : 'No registrada';
    const nup = d.nup || 'No registrado';
    const ficha = d.ficha || 'No registrada';
    const direccion = d.direccion || 'No registrada';
    const zona = d._tipo || '';
    const matriculaPDF = d.matricula || titulo;

    const fecha = new Date().toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });

    const filasHTML = rows.map(r => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px">${r.tipo}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px">${r.desc}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:right">${r.area}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:right">${r.pct}</td>
      </tr>`).join('');

    const mapSection = mapImgDataUrl
      ? `<div style="margin-top:24px">
           <div class="section-label">Figura Catastral</div>
           <img src="${mapImgDataUrl}" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;margin-top:6px"/>
         </div>`
      : `<p style="color:#888;font-size:12px;margin-top:16px">⚠️ Para incluir el mapa, primero haz clic en "Ver figura catastral" y luego descarga el PDF.</p>`;

    // Ficha del predio en 2 columnas
    const fichaHTML = `
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <tbody>
          <tr style="background:#f7fafc">
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;width:35%;text-transform:uppercase;letter-spacing:0.5px">Matrícula Inmobiliaria</td>
            <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a4fd6">${matriculaPDF}</td>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;width:35%;text-transform:uppercase;letter-spacing:0.5px">Zona</td>
            <td style="padding:8px 12px;font-size:13px;color:#2d3748">${zona}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.5px">NUP</td>
            <td style="padding:8px 12px;font-size:13px;color:#2d3748">${nup}</td>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.5px">Ficha Catastral</td>
            <td style="padding:8px 12px;font-size:13px;color:#2d3748">${ficha}</td>
          </tr>
          <tr style="background:#f7fafc">
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.5px">Área Catastral</td>
            <td style="padding:8px 12px;font-size:13px;color:#2d3748">${areaCat}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.5px">Dirección</td>
            <td colspan="3" style="padding:8px 12px;font-size:13px;color:#2d3748">${direccion}</td>
          </tr>
        </tbody>
      </table>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Informe Predial — ${matriculaPDF}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 32px; color: #2d3748; background: white; }
      .header { background: linear-gradient(135deg,#1a4fd6,#0e3ab8); color: white; padding: 22px 28px; border-radius: 12px; margin-bottom: 28px; display:flex; justify-content:space-between; align-items:center; }
      .header h1 { margin: 0 0 4px; font-size: 20px; }
      .header p  { margin: 0; font-size: 12px; opacity: 0.75; }
      .header-badge { background:rgba(255,255,255,0.15); padding:6px 14px; border-radius:20px; font-size:12px; font-weight:700; white-space:nowrap; }
      .section-label { font-size: 11px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 0.8px; margin: 22px 0 8px; }
      table.usos { width: 100%; border-collapse: collapse; }
      table.usos thead tr { background: #1a4fd6; color: white; }
      table.usos th { padding: 9px 10px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; }
      .footer { margin-top: 36px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 14px; }
      @media print { body { padding: 16px; } }
    </style></head><body>
    <div class="header">
      <div>
        <h1>Informe de Consulta Predial</h1>
        <p>Municipio de La Ceja del Tambo &nbsp;·&nbsp; Geo-Ceja &nbsp;·&nbsp; ${fecha}</p>
      </div>
      <div class="header-badge">${zona}</div>
    </div>
    <div class="section-label">Información del Predio</div>
    ${fichaHTML}
    <div class="section-label">Usos del Suelo</div>
    <table class="usos">
      <thead><tr><th>Tipo de suelo</th><th>Descripción</th><th>Área (m²)</th><th>%</th></tr></thead>
      <tbody>${filasHTML}</tbody>
    </table>
    ${mapSection}
    <div class="footer">
      <div style="display:flex;align-items:flex-start;gap:12px;justify-content:center;text-align:left;max-width:680px;margin:0 auto 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;">
        <div style="font-size:18px;flex-shrink:0">ℹ️</div>
        <div>
          <p style="margin:0 0 6px;font-size:11.5px;color:#4a5568;line-height:1.5">
            Conoce la clasificación del uso de suelo de tu predio. En caso de requerir más detalle, solicitar el <strong>Concepto de Norma Urbanística</strong> ante el Departamento Administrativo de Planeación.
          </p>
          <a href="${LINK_NORMA_URL}" style="color:#1a4fd6;font-size:11.5px;font-weight:700;text-decoration:none">
            🔗 ${LINK_NORMA_TEXTO} →
          </a>
        </div>
      </div>
      <p style="margin:0;font-size:10px;color:#aaa">Generado por Geo-Ceja &nbsp;·&nbsp; Alcaldía de La Ceja del Tambo &nbsp;·&nbsp; Observatorio Municipal</p>
    </div>
    </body></html>`;

    // Abrir ventana e imprimir como PDF
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };

  } catch(e) {
    showToast('Error generando PDF: ' + e.message);
  } finally {
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Descargar Informe PDF';
    btn.disabled = false;
  }
}

// ── BASEMAPS ──
const TILES = {
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 22,
      maxNativeZoom: 18
    }
  ),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
};

  // ── INIT MAP ──
  const map = L.map('map', {
    center: [6.027, -75.418],
    zoom: 11,
    maxZoom: 22,
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true  // <-- NUEVO: Obliga a Leaflet a dibujar vectores en Canvas en vez de SVG
  });
let activeBasemap = TILES.satellite;
activeBasemap.addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);


// ── MINI MAP ──
const minimap = L.map('minimap', {
  center: [6.027, -75.418], zoom: 8,
  zoomControl: false, attributionControl: false, dragging: false,
  scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 10 }).addTo(minimap);
map.on('moveend', () => minimap.setView(map.getCenter(), Math.max(map.getZoom() - 4, 4)));

// ── BASEMAP SWITCH ──
function setBasemap(name, btnId) {
  map.removeLayer(activeBasemap);
  activeBasemap = TILES[name];
  activeBasemap.addTo(map);
  document.querySelectorAll('.map-thumb').forEach(el => el.classList.remove('active'));
  document.getElementById(btnId).classList.add('active');
  showToast('Mapa base: ' + btnId.replace('mt-','').charAt(0).toUpperCase() + btnId.slice(4));
}

// ── COORDINATES ──
const coordsEl = document.getElementById('coords');
map.on('mousemove', e => {
  const la = e.latlng.lat, lo = e.latlng.lng;
  coordsEl.textContent = `${Math.abs(lo).toFixed(5)}° ${lo<0?'W':'E'} · ${Math.abs(la).toFixed(5)}° ${la>=0?'N':'S'}`;
});

// ── TABS ──
function switchTab(el, name) {
  document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  if (name === 'build') showToast('Modo Armar Mapa activado');
}

// ── GEOSERVER CONFIG (WMS) ────────────────────────────────────────────────
// Tomado de tu proyecto de referencia (config.js / layers.js / map.js), que
// ya confirmaste que funciona. WMS carga las capas como imágenes de mosaico
// (tiles), por eso no tiene los problemas de CORS que sí tiene WFS/fetch.
const GEOSERVER_WMS_URL   = 'https://geoserver.osorvilo.org/geoserver/wms';
const GEOSERVER_WORKSPACE = 'plan';
const GEOSERVER_WMS_VERSION = '1.1.1';

// Nombre visible en el panel → nombre EXACTO de la capa en GeoServer (SIN el workspace)
const GEOSERVER_LAYERS = {
  'Usos del suelo - Urbano': 'Usos_urbanos',   // = uso_residencial en tu layers.js
  'Usos del suelo - Rural':  'Usos_rurales',      // ← nueva
  'Perímetro urbano':     'Suelo Urbano',   // = suelo_urbano en tu layers.js
  'Expansión urbana':     'Suelo_Expansion',// = suelo_expansion en tu layers.js
  'Perimetro rural':      'Suelo_Rural',      // ← nueva
  'Division Veredal':     'División Veredal',      // ← nueva
  'Sectores Urbanos':     'Sectores Urbanos',      // ← nueva
};

// Capas WMS activas en el mapa (cache) — no tocar
const activeWmsLayers = {};

  // ── DATOS PARA LA LEYENDA ──
    const LEGEND_DATA = {
      'Usos del suelo - Urbano': {
        titulo: 'Urbano',
        items: [
          { label: 'Corredores de Comercio y Servicios (CCS)', color: '#d32f2f' },
          { label: 'Residencial 1', color: '#fff59d' },
          { label: 'Residencial 2', color: '#ffd54f' },
          { label: 'Residencial 3', color: '#ffb300' },
          { label: 'Uso Social Obligado (Equipamientos)', color: '#5e35b1' },
          { label: 'Uso Social Obligado (Espacio Público)', color: '#43a047' },
          { label: 'Zona de Comercio y Servicios Tipo 1 (ZCS-1)', color: '#1976d2' },
          { label: 'Zonas Preservación', color: '#1b5e20' },
          { label: 'Zonas Restauración', color: '#66bb6a' },
          { label: 'Zonas Uso Sostenible', color: '#aed581' }
        ]
      },
      'Usos del suelo - Rural': {
        titulo: 'Rural',
        items: [
          // Actividad Múltiple (ZAM)
          { label: 'ZAM Tipo I – El Yegüerizo', color: '#f6b02e' },
          { label: 'ZAM Tipo I – La Ceja - Abejorral', color: '#e8c828' },
          { label: 'ZAM Tipo I – La Ceja - La Unión', color: '#d9c436' },
          { label: 'ZAM Tipo I – Paquita - Toledo', color: '#d4a76a' },
          { label: 'ZAM Tipo II – Paquita - Toledo', color: '#f57c00' },
          // Equipamientos, Industria y Servicios
          { label: 'Zona de Equipamientos (ZE)', color: '#666666' },
          { label: 'Zona de Industria Menor (ZIM) La Guyana', color: '#99947c' },
          { label: 'Zona de Protección Cultural (ZPC)', color: '#c2185b' },
          { label: 'Zona de Servicios Públicos (ZPS)', color: '#4a5be0' },
          { label: 'Zona de Servicios Públicos (ZPS) La Ceja', color: '#4a5be0' },
          // Preservación (ZPre)
          { label: 'ZPre – DRMI Cerros de San Nicolás', color: '#339933' },
          { label: 'ZPre – DRMI El Capiro', color: '#339933' },
          { label: 'ZPre – Humedal La María', color: '#00f57a' },
          { label: 'ZPre – Humedal La Milagrosa', color: '#00f57a' },
          { label: 'ZPre – Rondas Hídricas', color: '#1a5cd6' },
          // Restauración (ZR)
          { label: 'ZR – ACP Pomca Restauración Ecológica', color: '#6aa0c8' },
          { label: 'ZR – Áreas Prioritarias Restauración', color: '#44cc1a' },
          { label: 'ZR – DRMI Cerros de San Nicolás', color: '#a033e0' },
          { label: 'ZR – DRMI El Capiro', color: '#d63384' },
          { label: 'ZR – Rondas Hídricas', color: '#3b6982' },
          // Uso Sostenible (ZUS) y Uso Público (ZGUP)
          { label: 'ZUS – DRMI Cerros de San Nicolás', color: '#8ce02c' },
          { label: 'ZUS – DRMI El Capiro', color: '#8ce02c' },
          { label: 'ZUS – Rondas Hídricas', color: '#c5d9e8' },
          { label: 'ZGUP – DRMI El Capiro', color: '#d4df80' },
          // Explotación RRNN y Residencial Rural
          { label: 'Zona para la Explotación RRNN (ZERN)', color: '#999999' },
          { label: 'Parcelación Tradicional (ZRCT)', color: '#ff00d4' },
          { label: 'Parcelación Productiva (ZRCP)', color: '#e619d6' },
          { label: 'Zona Residencial Rural (ZRR)', color: '#1f3a60' },
          // Protección (ZPro)
          { label: 'ZPro – ACP Pomca Áreas Complementarias', color: '#4de04d' },
          { label: 'ZPro – ACP Pomca Amenazas Naturales', color: '#e0401a' },
          { label: 'ZPro – ACP Pomca Importancia Ambiental', color: '#1a9973' },
          { label: 'ZPro – ACP Pomca Rehabilitación Conservación', color: '#8fa629' },
          { label: 'ZPro – Alta Movimiento en Masa', color: '#a61919' },
          { label: 'ZPro – Pendientes Sup. 75%', color: '#e01a1a' },
          { label: 'ZPro – Predios Protección Hídrica', color: '#a6cce3' },
          { label: 'ZPro – Red Conectividad: Enlaces', color: '#b35c33' },
          { label: 'ZPro – Red Conectividad: Fragmentos', color: '#6b381f' },
          { label: 'ZPro – Red Conectividad: Nodos', color: '#d98047' },
          { label: 'ZPro – Rondas Hídricas', color: '#1a75d6' },
          // Producción (ZPAF / ZPS)
          { label: 'Producción Agroforestal (ZPAF) Pendientes', color: '#5ce085' },
          { label: 'Producción Sostenible (ZPS)', color: '#99cc29' }
        ]
      },
      'Perímetro urbano': {
        titulo: 'Clasificación del Suelo',
        items: [
          { label: 'Suelo Urbano', color: '#ff9800' }
        ]
      },
      'Perimetro rural': {
        titulo: 'Clasificación del Suelo',
        items: [
          { label: 'Suelo Rural', color: '#7cb342' }
        ]
      },
      'Expansión urbana': {
        titulo: 'Clasificación del Suelo',
        items: [
          { label: 'Suelo de Expansión', color: '#f44336' }
        ]
      },
      'Sectores Urbanos': {
        titulo: 'División Urbana',
        items: [
          { label: 'Centro', color: '#e04b33' },
          { label: 'Cuatro Esquinas', color: '#ee7647' },
          { label: 'El Tambo', color: '#f8a055' },
          { label: 'Fátima', color: '#fcc377' },
          { label: 'Fray Eugenio Ramírez Salazar', color: '#fee09a' },
          { label: 'Hipódromo', color: '#fef8b7' },
          { label: 'La Floresta', color: '#dff0b2' },
          { label: 'María Auxiliadora', color: '#c4e2a8' },
          { label: 'Ofir', color: '#a2d39c' },
          { label: 'Payuco', color: '#7db8a4' },
          { label: 'San Cayetano', color: '#579bb0' },
          { label: 'Tahamí', color: '#2d7eb3' }
        ]
      },
      'Division Veredal': {
        titulo: 'División Política',
        items: [
          { label: 'Division Veredal', color: '#5c2d0c', borderOnly: true }
        ]
      }
    };

    // Actualiza el contenido de la leyenda basándose en las capas WMS activas
    function updateLegend() {
      const content = document.getElementById('legend-content');
      const legendWrap = document.getElementById('map-legend');
      let html = '';
      let activeCount = 0;

      // Revisar qué capas WMS están activas en el mapa
      for (const layerName in LEGEND_DATA) {
        if (activeWmsLayers[layerName] && map.hasLayer(activeWmsLayers[layerName])) {
          activeCount++;
          const data = LEGEND_DATA[layerName];
          html += `<div class="leg-section">`;
          html += `<div class="leg-title">${data.titulo} (${layerName})</div>`;
          data.items.forEach(item => {
            const swatchStyle = item.borderOnly
              ? `background:transparent; border:2.5px solid ${item.color};`
              : `background:${item.color};`;
            html += `<div class="leg-item"><div class="leg-color" style="${swatchStyle}"></div><span>${item.label}</span></div>`;
          });
          html += `</div>`;
        }
      }

      // Si hay al menos una capa con leyenda, la mostramos; si no, la ocultamos.
      if (activeCount > 0) {
        content.innerHTML = html;
        legendWrap.classList.add('show');
      } else {
        legendWrap.classList.remove('show');
      }
    }

    // Hacer la leyenda arrastrable al cargar el mapa
    setTimeout(() => {
      const legendEl = document.getElementById('map-legend');
      const legendDragHandle = document.getElementById('legend-header');
      // Usamos el L.Draggable nativo de Leaflet
      const draggable = new L.Draggable(legendEl, legendDragHandle);
      draggable.enable();
    }, 1000);

    // Ocultar o mostrar el contenido de la leyenda (minimizar)
      function toggleLegendContent() {
        document.getElementById('legend-content').classList.toggle('minimized');
        document.getElementById('legend-toggle').classList.toggle('minimized');
      }
 
     let labelsEnabled = true;

      // Capa WMS de imagen única (evita etiquetas duplicadas y permite prender/apagar etiquetas)
      const SingleTileWMS = L.Layer.extend({
        initialize(url, options) {
          this._url = url;
          this._options = options;
          this._overlay = null;
          this._pending = null;
        },
        onAdd(map) {
          this._map = map;
          this._update();
          map.on('moveend', this._update, this);
        },
        onRemove(map) {
          map.off('moveend', this._update, this);
          if (this._overlay) { map.removeLayer(this._overlay); this._overlay = null; }
          if (this._pending) { map.removeLayer(this._pending); this._pending = null; }
          this._map = null;
        },
        bringToFront() {
          if (this._overlay) this._overlay.bringToFront();
          return this;
        },
        setEnv(envStr) {
          this._options.env = envStr;
          if (this._map) this._update();
        },
        _update() {
          if (!this._map) return;
          const size = this._map.getSize();
          if (size.x === 0 || size.y === 0) return;

          const bounds = this._map.getBounds();
          const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
          const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());

          const params = new URLSearchParams({
            service: 'WMS',
            version: this._options.version || '1.1.1',
            request: 'GetMap',
            layers: this._options.layers,
            styles: '',
            format: this._options.format || 'image/png',
            transparent: 'true',
            srs: 'EPSG:3857',
            bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
            width: size.x,
            height: size.y,
            env: this._options.env || 'etiquetas:1'
          });

          if (this._pending) {
            this._map.removeLayer(this._pending);
            this._pending = null;
          }

          const next = L.imageOverlay(`${this._url}?${params.toString()}`, bounds, { interactive: false });
          this._pending = next;
          next.once('load', () => {
            if (!this._map || this._pending !== next) return;
            if (this._overlay) this._map.removeLayer(this._overlay);
            this._overlay = next;
            this._pending = null;
          });
          next.addTo(this._map);
        }
      });

      // Añade o quita una capa WMS de GeoServer en el mapa
      function toggleWmsLayer(displayName, on) {
        const layerName = GEOSERVER_LAYERS[displayName];
        if (!layerName) return false;

        if (!on) {
          if (activeWmsLayers[displayName]) {
            map.removeLayer(activeWmsLayers[displayName]);
          }
          updateLegend();
          return true;
        }

        const envVal = labelsEnabled ? 'etiquetas:1' : 'etiquetas:0';

        if (activeWmsLayers[displayName]) {
          if (typeof activeWmsLayers[displayName].setEnv === 'function') {
            activeWmsLayers[displayName]._options.env = envVal;
          }
          activeWmsLayers[displayName].addTo(map);
          activeWmsLayers[displayName].bringToFront();
          updateLegend();
          return true;
        }

        const SINGLE_TILE_LAYERS = ['Division Veredal', 'Sectores Urbanos', 'Sectores'];
        const useSingleTile = SINGLE_TILE_LAYERS.includes(displayName);

        const wmsLayer = useSingleTile
          ? new SingleTileWMS(GEOSERVER_WMS_URL, {
            layers: `${GEOSERVER_WORKSPACE}:${layerName}`,
            format: 'image/png',
            version: GEOSERVER_WMS_VERSION,
            env: envVal
          })
          : L.tileLayer.wms(GEOSERVER_WMS_URL, {
            layers: `${GEOSERVER_WORKSPACE}:${layerName}`,
            format: 'image/png',
            transparent: true,
            version: GEOSERVER_WMS_VERSION,
            attribution: '© Municipio de La Ceja del Tambo',
            maxZoom: 22,
            maxNativeZoom: 19
          });

        if (!useSingleTile) {
          wmsLayer.on('tileerror', () => {
            showToast('❌ Error cargando "' + displayName + '" desde GeoServer');
          });
        }

        wmsLayer.addTo(map);
        activeWmsLayers[displayName] = wmsLayer;
        showToast('✅ "' + displayName + '" cargada');
        updateLegend();
        return true;
      }

      // Prende o apaga las etiquetas en las capas compatibles
      function toggleLabels() {
        labelsEnabled = !labelsEnabled;
        const envVal = labelsEnabled ? 'etiquetas:1' : 'etiquetas:0';

        const btn = document.getElementById('btn-toggle-labels');
        if (btn) {
          btn.classList.toggle('active', labelsEnabled);
          btn.setAttribute('data-tip', labelsEnabled ? 'Etiquetas: ON' : 'Etiquetas: OFF');
        }

        for (const name in activeWmsLayers) {
          const layer = activeWmsLayers[name];
          if (layer && map.hasLayer(layer) && typeof layer.setEnv === 'function') {
            layer.setEnv(envVal);
          }
        }

        showToast(labelsEnabled ? '🏷️ Etiquetas activadas' : '🏷️ Etiquetas ocultas');
      }
// Consulta atributos (GetFeatureInfo) de las capas GeoServer activas al hacer clic
function queryActiveWmsLayers(latlng, containerPoint) {
  const activeNames = Object.keys(activeWmsLayers).filter(n => map.hasLayer(activeWmsLayers[n]));
  if (activeNames.length === 0) return;

  const displayName = activeNames[activeNames.length - 1]; // la última capa activada (la de arriba)
  const layerName = GEOSERVER_LAYERS[displayName];
  const size = map.getSize();
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const fullLayerName = `${GEOSERVER_WORKSPACE}:${layerName}`;

  const params = new URLSearchParams({
    service: 'WMS',
    version: GEOSERVER_WMS_VERSION,
    request: 'GetFeatureInfo',
    layers: fullLayerName,
    query_layers: fullLayerName,
    bbox: `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`,
    width: size.x,
    height: size.y,
    srs: 'EPSG:4326',
    info_format: 'application/json',
    x: Math.round(containerPoint.x),
    y: Math.round(containerPoint.y),
    feature_count: 5
  });

  fetch(`${GEOSERVER_WMS_URL}?${params.toString()}`)
    .then(r => r.json())
    .then(data => {
      if (!data.features || data.features.length === 0) return;
      const props = data.features[0].properties || {};
      const rows = Object.entries(props)
        .filter(([, v]) => v !== null && v !== '')
        .slice(0, 10)
        .map(([k, v]) => `<tr><td style="font-weight:600;padding-right:8px">${k}</td><td>${v}</td></tr>`)
        .join('');
      if (rows) {
        L.popup({ maxWidth: 340 }).setLatLng(latlng)
          .setContent(`<div class="popup-title">${displayName}</div><table style="font-size:12px">${rows}</table>`)
          .openOn(map);
      }
    })
    .catch(() => { /* silencioso: el clic normal del mapa no debe interrumpirse */ });
}
  // ── SÍMBOLOS TEMÁTICOS PARA LAS CAPAS ──
    const SYMBOLS = {
      area: '<svg viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.5"><polygon points="3,11 10,3 21,6 18,18 8,21"/></svg>',
      rural: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l5-6 4 4 4-5 5 7H3z" fill="currentColor" fill-opacity="0.25"/><path d="M2 21h20"/><circle cx="17.5" cy="6.5" r="2"/></svg>`,
      line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 20L20 4"/></svg>',
      border: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>',
      home: '<svg viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>',
      point: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"/></svg>'
      
    };

  // ── LAYER CATEGORIES ──
  const CATEGORIES = [
    // === 1. CATEGORÍAS ACTIVAS (Aparecerán de primeras) ===
    {
      name: 'Ordenamiento Territorial', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`, badge: 7, layers: [
        { name: 'Usos del suelo - Urbano', color: '#fdd835', typé: 'area' },
        { name: 'Usos del suelo - Rural', color: '#2e7d32', type: 'rural' },
        { name: 'Perímetro urbano', color: '#e91e63', type: 'border'},
        { name: 'Perimetro rural', color: '#7cb342' },
        { name: 'Expansión urbana', color: '#f06292', type: 'home' },
        { name: 'Division Veredal', color: '#5c2d0c'},
        { name: 'Sectores Urbanos', color: '#e04b33', type: 'area' },
        //{ name: 'Predios catastrales', color: '#8e24aa' }, // Búsqueda conectada a Supabase
      ]
    },

    // === 2. CATEGORÍAS INACTIVAS (Ocultas temporalmente con /* ... */) ===
    /*
    {
      name: 'Mapa de Referencia (Mapas N…', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>`, badge: null, layers: [
        { name: 'Límites municipales', color: '#e53935', checked: true },
        { name: 'Veredas', color: '#fb8c00' },
        { name: 'Red vial', color: '#757575', checked: true },
        { name: 'Curvas de nivel', color: '#a5d6a7' },
      ]
    },
    { name: 'Ambiente y Desarrollo Sosten…', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`, badge: null, layers: [
      { name: 'Cobertura vegetal 2024', color: '#43a047' },
      { name: 'Áreas protegidas', color: '#00897b' },
      { name: 'Cuencas hidrográficas', color: '#1e88e5' },
      { name: 'Riesgo por inundación', color: '#e53935' },
      { name: 'Suelos degradados', color: '#795548' },
    ]},
    { name: 'Ciencia, Tecnología e Innovaci…', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M6.3 6.3a7 7 0 0 0 0 11.4M17.7 6.3a7 7 0 0 1 0 11.4M4 12a8 8 0 0 0 3.5 6.7M4 12a8 8 0 0 1 3.5-6.7M20 12a8 8 0 0 1-3.5 6.7M20 12a8 8 0 0 0-3.5-6.7"/></svg>`, badge: null, layers: [
      { name: 'Conectividad rural', color: '#7b1fa2' },
      { name: 'Puntos de acceso WiFi', color: '#6a1b9a' },
    ]},
    { name: 'Comercio, Industria y Turismo', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`, badge: null, layers: [
      { name: 'Zonas industriales', color: '#f57f17' },
      { name: 'Atractivos turísticos', color: '#e91e63' },
      { name: 'Mercados y plazas', color: '#ff8f00' },
    ]},
    { name: 'Cultura', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`, badge: null, layers: [
      { name: 'Patrimonio cultural', color: '#e65100' },
      { name: 'Parques y plazas', color: '#558b2f' },
      { name: 'Equipamientos culturales', color: '#ad1457' },
    ]},
    { name: 'Educación', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`, badge: null, layers: [
      { name: 'Instituciones educativas', color: '#1565c0' },
      { name: 'Cobertura educativa', color: '#0d47a1' },
    ]},
    { name: 'Estadísticas Nacionales', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`, badge: null, layers: [
      { name: 'Densidad poblacional', color: '#4a148c' },
      { name: 'NBI por vereda', color: '#880e4f' },
    ]},
    { name: 'Función Pública', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`, badge: null, layers: [
      { name: 'Sedes institucionales', color: '#37474f' },
      { name: 'Notarías y registros', color: '#546e7a' },
    ]},
    { name: 'Presupuestos Gubernamental…', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`, badge: null, layers: [
      { name: 'Proyectos de inversión', color: '#00838f' },
    ]},
    { name: 'Salud y Protección Social', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`, badge: null, layers: [
      { name: 'IPS y centros de salud', color: '#c62828' },
      { name: 'Cobertura salud', color: '#b71c1c' },
    ]},
    { name: 'Transporte', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`, badge: null, layers: [
      { name: 'Red vial primaria', color: '#e53935' },
      { name: 'Red vial secundaria', color: '#fb8c00' },
      { name: 'Rutas de transporte', color: '#1e88e5' },
    ]},
    { name: 'Vivienda, Ciudad y Territorio', icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`, badge: null, layers: [
      { name: 'Estratificación socioeconómica', color: '#6a1b9a' },
      { name: 'Barrios y comunas', color: '#4a148c' },
      { name: 'Vivienda de interés social', color: '#1a237e' },
    ]},
    */
  ];

// Build layer list
function buildLayerList(cats) {
  const container = document.getElementById('layer-list');
  container.innerHTML = '';
  cats.forEach((cat, ci) => {
    const catDiv = document.createElement('div');
    catDiv.className = 'layer-category';
    catDiv.dataset.cat = ci;

    const header = document.createElement('div');
    header.className = 'layer-cat-header';
    header.innerHTML = `
      <div class="layer-cat-left">
        <svg class="layer-cat-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">${cat.icon.match(/<svg[^>]*>(.*?)<\/svg>/s)?.[1]||''}</svg>
        <span class="layer-cat-name">${cat.name}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${cat.badge ? `<span class="layer-badge">${cat.badge}</span>` : ''}
        <svg class="chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    header.onclick = () => toggleCat(catDiv);

    const body = document.createElement('div');
    body.className = 'layer-cat-body';
    cat.layers.forEach(layer => {
      const row = document.createElement('label');
      row.className = 'layer-item-row';

      // Si la capa no tiene un 'type' definido, usa 'area' (el polígono) por defecto
      const symbolSvg = SYMBOLS[layer.type] || SYMBOLS.area;

      row.innerHTML = `
        <input type="checkbox" class="layer-checkbox" ${layer.checked ? 'checked' : ''} onchange="onLayerToggle('${layer.name}',this.checked)"/>
        <span class="layer-symbol" style="color:${layer.color}">${symbolSvg}</span>
        ${layer.name}`;
      body.appendChild(row);
    });

    catDiv.appendChild(header);
    catDiv.appendChild(body);
    container.appendChild(catDiv);
  });
}
buildLayerList(CATEGORIES);

function toggleCat(catDiv) {
  const body = catDiv.querySelector('.layer-cat-body');
  const chevron = catDiv.querySelector('.chevron');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  chevron.classList.toggle('open', !isOpen);
}

function filterLayers(q) {
  q = q.toLowerCase();
  if (!q) { buildLayerList(CATEGORIES); return; }
  const filtered = CATEGORIES.map(c => ({
    ...c, layers: c.layers.filter(l => l.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
  })).filter(c => c.layers.length > 0);
  buildLayerList(filtered);
  document.querySelectorAll('.layer-cat-body').forEach(b => b.classList.add('open'));
  document.querySelectorAll('.chevron').forEach(ch => ch.classList.add('open'));
}

function onLayerToggle(name, on) {
  const isGeoServerLayer = toggleWmsLayer(name, on);
  if (!isGeoServerLayer) {
    // Capa aún no conectada a GeoServer: solo feedback visual por ahora
    showToast((on ? '✅ ' : '❌ ') + name);
  }
}

// ── PLACES ──
const PLACES = [
  { name: 'La Ceja del Tambo', lat: 6.027, lng: -75.418, z: 13 },
  { name: 'El Retiro', lat: 5.888, lng: -75.514, z: 13 },
  { name: 'Abejorral', lat: 5.793, lng: -75.430, z: 12 },
  { name: 'Marinilla', lat: 6.175, lng: -75.336, z: 12 },
  { name: 'El Carmen de Viboral', lat: 6.088, lng: -75.338, z: 13 },
  { name: 'Guarne', lat: 6.279, lng: -75.432, z: 13 },
  { name: 'Rionegro', lat: 6.153, lng: -75.374, z: 12 },
  { name: 'Sonsón', lat: 5.836, lng: -75.487, z: 12 },
  { name: 'Argelia', lat: 5.717, lng: -75.454, z: 12 },
  { name: 'Granada', lat: 6.151, lng: -75.196, z: 12 },
  { name: 'Medellín', lat: 6.2518, lng: -75.5636, z: 12 },
  { name: 'Cocorná', lat: 6.063, lng: -75.175, z: 12 },
  { name: 'San Luis', lat: 6.043, lng: -74.997, z: 12 },
];

function onSearchType(val) {
  const sug = document.getElementById('search-suggestions');
  if (!val.trim()) { sug.style.display = 'none'; return; }
  const matches = PLACES.filter(p => p.name.toLowerCase().includes(val.toLowerCase()));
  if (!matches.length) { sug.style.display = 'none'; return; }
  sug.style.display = 'block';
  sug.innerHTML = matches.map(p => `
    <div class="suggestion-item" onclick="goPlace(${p.lat},${p.lng},${p.z},'${p.name}')">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      ${p.name}
    </div>`).join('');
}
function doSearch(val) {
  const match = PLACES.find(p => p.name.toLowerCase().includes(val.toLowerCase()));
  if (match) goPlace(match.lat, match.lng, match.z, match.name);
  else showToast('Sin resultados para "' + val + '"');
  document.getElementById('search-suggestions').style.display = 'none';
}
function goPlace(lat, lng, z, name) {
  map.setView([lat, lng], z);
  L.popup().setLatLng([lat, lng])
    .setContent(`<div class="popup-title">${name}</div><div class="popup-coords">${lat.toFixed(5)}°N, ${Math.abs(lng).toFixed(5)}°W</div>`)
    .openOn(map);
  document.getElementById('search-input-top').value = name;
  document.getElementById('search-suggestions').style.display = 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('#search-bar')) document.getElementById('search-suggestions').style.display = 'none';
});

// ── DRAW / MEASURE ──
let drawMode = false, measuring = false, measureType = '', measurePts = [], measureLine = null;

function toggleDrawMode() {
  drawMode = !drawMode; measuring = false;
  map.getContainer().style.cursor = drawMode ? 'crosshair' : '';
  // botón Marcador eliminado del UI
  showToast(drawMode ? 'Clic en el mapa para agregar marcador' : 'Modo marcador desactivado');
}
function startMeasure(type) {
  clearMeasureState();
  measuring = true; measureType = type; drawMode = false;
  map.getContainer().style.cursor = 'crosshair';
  document.getElementById('measure-float').style.display = 'block';
  showToast('Midiendo ' + (type === 'distance' ? 'distancia' : 'área') + ' — doble clic para terminar');
}
function clearMeasureState() {
  measuring = false; measurePts = [];
  if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
  document.getElementById('measure-float').style.display = 'none';
  map.getContainer().style.cursor = '';
}

map.on('click', e => {
  if (drawMode) {
    L.circleMarker(e.latlng, { radius: 9, fillColor: '#00b4c8', color: '#fff', weight: 2.5, fillOpacity: 0.9 })
      .addTo(map).bindPopup(`<div class="popup-title">Marcador</div><div class="popup-coords">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</div>`);
    return;
  }
  if (measuring) {
    measurePts.push(e.latlng);
    if (measureLine) map.removeLayer(measureLine);
    measureLine = L.polyline(measurePts, { color: '#00b4c8', weight: 3, dashArray: '6,4' }).addTo(map);
    let total = 0;
    for (let i = 1; i < measurePts.length; i++) total += measurePts[i-1].distanceTo(measurePts[i]);
    document.getElementById('measure-val').textContent = total >= 1000 ? (total/1000).toFixed(3) + ' km' : total.toFixed(1) + ' m';
    return;
  }
  // Clic normal (sin modo activo): consultar atributos de la capa GeoServer activa
  queryActiveWmsLayers(e.latlng, map.latLngToContainerPoint(e.latlng));
});
map.on('dblclick', () => { if (measuring) clearMeasureState(); });

// ── MY LOCATION ──
function goMyLocation() {
  showToast('Obteniendo ubicación GPS…');
  navigator.geolocation.getCurrentPosition(pos => {
    map.setView([pos.coords.latitude, pos.coords.longitude], 15);
    L.circleMarker([pos.coords.latitude, pos.coords.longitude], { radius: 10, fillColor: '#1a4fd6', color: '#fff', weight: 3, fillOpacity: 0.9 })
      .addTo(map).bindPopup('<div class="popup-title">📍 Mi ubicación</div>').openPopup();
  }, () => showToast('No se pudo obtener ubicación'));
}

// ── CONTEXT MENU ──
let ctxLL = null;
map.getContainer().addEventListener('contextmenu', e => {
  e.preventDefault();
  ctxLL = map.mouseEventToLatLng(e);
  const m = document.getElementById('ctx-menu');
  m.style.display = 'block';
  m.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
});
document.addEventListener('click', hideCtxMenu);
function hideCtxMenu() { document.getElementById('ctx-menu').style.display = 'none'; }
function ctxZoomIn() { if (ctxLL) map.setView(ctxLL, map.getZoom()+1); hideCtxMenu(); }
function ctxZoomOut() { if (ctxLL) map.setView(ctxLL, map.getZoom()-1); hideCtxMenu(); }
function ctxAddMarker() {
  if (ctxLL) L.circleMarker(ctxLL, { radius: 9, fillColor: '#e53935', color: '#fff', weight: 2.5, fillOpacity: 0.9 })
    .addTo(map).bindPopup(`<div class="popup-title">Marcador</div><div class="popup-coords">${ctxLL.lat.toFixed(5)}, ${ctxLL.lng.toFixed(5)}</div>`).openPopup();
  hideCtxMenu();
}
function ctxCopyCoords() {
  if (ctxLL) { navigator.clipboard.writeText(`${ctxLL.lat.toFixed(6)}, ${ctxLL.lng.toFixed(6)}`).catch(()=>{}); showToast(`Coordenadas copiadas`); }
  hideCtxMenu();
}

// ── PRINT ──
function printMap() { showToast('Preparando impresión…'); setTimeout(() => window.print(), 500); }

// ── SHARE ──
function shareMap() {
  const c = map.getCenter(); const z = map.getZoom();
  const url = `${location.href.split('?')[0]}?lat=${c.lat.toFixed(5)}&lng=${c.lng.toFixed(5)}&z=${z}`;
  navigator.clipboard.writeText(url).catch(()=>{});
  showToast('Enlace del mapa copiado al portapapeles');
}

// ── CLEAR ALL ──
function clearAll() {
  clearMeasureState(); drawMode = false;
  map.getContainer().style.cursor = '';
  showToast('Dibujos y mediciones borrados');
}

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
