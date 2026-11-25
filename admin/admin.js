const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const CAMPOS = ['matricula','nup','primer_ape','segundo_ap','area_terr','ficha','direccion'];
// Qué puede ver cada rol
const PERMISOS = { admin:['predios','cargar','informe','campos','usuarios'], editor:['predios','cargar','informe'], consulta:['predios','informe'] };
const NOMBRES = { predios:'Predios', cargar:'Cargar datos', informe:'Informes', campos:'Campos', usuarios:'Usuarios' };
const slug = t => t.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
function cerrarModal(){ $('modal').hidden = true; }
$('modal').onclick = e => e.target.id==='modal' && cerrarModal();
document.addEventListener('keydown', e => e.key==='Escape' && cerrarModal());
const modalHTML = (t,b) => `<div class="mh"><h3>${t}</h3><button type="button" class="x" onclick="cerrarModal()">✕</button></div>${b}`;
let perfil = null, filas = [], cargaPend = [];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(m){ const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none',3500); }
const puedeEditar = () => perfil && ['admin','editor'].includes(perfil.rol);

// ── Sesión ──
async function init(){ const {data:{session}} = await sb.auth.getSession(); session ? entrar(session.user) : ($('login').hidden=false); }
$('login-form').onsubmit = async e => {
  e.preventDefault(); $('login-err').textContent='';
  const {data,error} = await sb.auth.signInWithPassword({email:$('email').value.trim(), password:$('pass').value});
  if (error) return $('login-err').textContent = 'Correo o contraseña incorrectos.';
  entrar(data.user);
};
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
async function entrar(user){
  const {data,error} = await sb.from('perfiles').select('nombre,rol,activo').eq('id',user.id).maybeSingle();
  if (error || !data || !data.activo){
    await sb.auth.signOut(); $('login').hidden = false;
    $('login-err').textContent = error ? 'No se pudo leer tu perfil: ' + error.message
      : !data ? 'Tu usuario existe pero no tiene perfil. Pide al administrador que lo cree.'
      : 'Tu usuario está inactivo. Pide al administrador que lo active.';
    return;
  }
  perfil = {...data, email:user.email};
  $('login').hidden = true; $('app').hidden = false;
  $('quien').textContent = `${perfil.nombre || ''} · ${perfil.email}`; $('rol').textContent = perfil.rol;
  const vistas = PERMISOS[perfil.rol] || [];
  $('tabs').innerHTML = vistas.map(v=>`<button data-v="${v}">${NOMBRES[v]}</button>`).join('');
  $('tabs').onclick = e => e.target.dataset.v && ir(e.target.dataset.v);
  ir(vistas[0]);
}
function ir(v){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on', b.dataset.v===v));
  ['predios','cargar','informe','campos','usuarios'].forEach(x=>$('v-'+x).hidden = x!==v);
  if (v==='predios') buscarPredios(); if (v==='campos') verCampos(); if (v==='usuarios') cargarUsuarios();
}

// ── 1. Predios: columnas reales de la base, con visibilidad configurable ──
const TEXTO = ['text','character varying','character'];
const NUM = ['numeric','integer','bigint','smallint','double precision','real'];
const TIPOS = {text:'Texto','character varying':'Texto',character:'Texto',numeric:'Número',integer:'Entero',bigint:'Entero',smallint:'Entero','double precision':'Decimal',real:'Decimal',date:'Fecha',boolean:'Sí / No'};
let cols = [], colsTabla = '', ocultas = new Set(), cfg = {};
const RELACIONADAS = {   // [tabla relacionada, columna que la enlaza, campo del predio]
  urbano: [['resultado_uso_predio','predio_id','id']],
  Rural:  [['resultado_uso_predio_rural','predio_id','id']]
};
async function cargarCols(t, forzar){
  if (colsTabla === t && !forzar) return;
  const [{data,error}, {data:cf}] = await Promise.all([sb.rpc('listar_columnas',{p_tabla:t}), sb.from('campos_config').select('*').eq('tabla',t)]);
  cols = (!error && data?.length) ? data.filter(c=>c.data_type!=='USER-DEFINED' && c.column_name!=='geom')
    : [{column_name:'id',data_type:'bigint'}, ...CAMPOS.map(c=>({column_name:c,data_type:'text'}))];
  cfg = Object.fromEntries((cf||[]).map(x=>[x.columna,x]));
  ocultas = new Set((cf||[]).filter(x=>!x.visible).map(x=>x.columna));
  colsTabla = t;
  $('p-col').innerHTML = cols.filter(c=>TEXTO.includes(c.data_type)).map(c=>`<option>${esc(c.column_name)}</option>`).join('');
  if ([...$('p-col').options].some(o=>o.value==='matricula')) $('p-col').value = 'matricula';
}
const sel = cs => cs.map(n=>`"${n}"`).join(',');
async function buscarPredios(){
  const t = $('p-tabla').value, q = $('p-q').value.trim();
  await cargarCols(t);
  const vis = cols.filter(c=>!ocultas.has(c.column_name)), nombres = vis.map(c=>c.column_name);
  let r = sb.from(t).select(sel([...new Set(['id',...nombres])])).order(nombres.includes('matricula')?'matricula':'id').limit(100);
  if (q) r = r.ilike($('p-col').value, `%${q}%`);
  const {data,error} = await r; if (error) return toast('Error: '+error.message);
  filas = data;
  $('p-tbl').innerHTML = `<tr>${vis.map(c=>`<th>${esc(c.column_name)}</th>`).join('')}<th></th></tr>` +
    data.map(f=>`<tr>${vis.map(c=>`<td>${esc(f[c.column_name])}</td>`).join('')}<td style="white-space:nowrap"><button class="btn ghost" data-ver="${f.id}">Ver todo</button> ${puedeEditar()?`<button class="btn" data-id="${f.id}">Editar</button>`:''}</td></tr>`).join('') +
    (data.length ? '' : `<tr><td colspan="99" class="muted">Sin resultados.</td></tr>`);
}
$('p-buscar').onclick = buscarPredios; $('p-tabla').onchange = () => { colsTabla=''; buscarPredios(); };
$('p-limpiar').onclick = () => { $('p-q').value=''; buscarPredios(); };
$('p-q').onkeyup = e => e.key==='Enter' && buscarPredios();
$('p-tbl').onclick = e => { const d=e.target.dataset; if (d.ver) verTodo(d.ver); if (d.id) editar(d.id); };
async function filaCompleta(id){   // trae TODAS las columnas (incluidas las ocultas en la tabla)
  const {data,error} = await sb.from($('p-tabla').value).select(sel(cols.map(c=>c.column_name))).eq('id',id).single();
  if (error) { toast('Error: '+error.message); return null; } return data;
}
async function editar(id){
  const f = await filaCompleta(id); if (!f) return;
  const campo = c => { const n=c.column_name, dt=c.data_type, v=f[n]??'';
    if (n==='id') return `<label>id</label><input value="${esc(v)}" disabled>`;
    if (dt==='boolean') return `<label>${esc(n)}</label><select name="${esc(n)}"><option value="">—</option><option value="true" ${v===true?'selected':''}>Sí</option><option value="false" ${v===false?'selected':''}>No</option></select>`;
    const tipo = NUM.includes(dt)?'type="number" step="any"':dt==='date'?'type="date"':'type="text"';
    return `<label>${esc(n)} <small>(${TIPOS[dt]||esc(dt)})</small></label><input ${tipo} name="${esc(n)}" value="${esc(v)}">`; };
  $('m-form').style.width = '';
  $('m-form').innerHTML = modalHTML('Editar predio', cols.map(campo).join('') + `<button class="btn">Guardar</button><button type="button" class="btn ghost" onclick="cerrarModal()">Cancelar</button>`);
  $('modal').hidden = false;
  const dts = Object.fromEntries(cols.map(c=>[c.column_name,c.data_type]));
  $('m-form').onsubmit = async e => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    for (const k in o){ if (o[k]==='') o[k]=null; else if (NUM.includes(dts[k])) o[k]=Number(String(o[k]).replace(',','.')); else if (dts[k]==='boolean') o[k]=o[k]==='true'; }
    const {data,error} = await sb.from($('p-tabla').value).update(o).eq('id',id).select();
    if (error) return toast('Error: '+error.message);
    if (!data.length) return toast('Sin permiso para modificar este predio.');
    cerrarModal(); toast('Predio actualizado'); buscarPredios();
  };
}
const tablaKV = o => `<table>${Object.entries(o).filter(([k])=>k!=='geom').map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
async function verTodo(id){
  const f = await filaCompleta(id); if (!f) return;
  let html = `<div class="scroll">${tablaKV(f)}</div>`;
  for (const [tabla,enlace,campo] of RELACIONADAS[$('p-tabla').value] || []){
    const {data,error} = await sb.from(tabla).select('*').eq(enlace,f[campo]).limit(200);
    html += `<h4>${esc(tabla)}</h4>`;
    if (error) html += `<p class="err">${esc(error.message)}</p>`;
    else if (!data.length) html += `<p class="muted">Sin registros relacionados.</p>`;
    else { const ks = Object.keys(data[0]).filter(k=>k!=='geom');
      html += `<div class="scroll"><table><tr>${ks.map(k=>`<th>${esc(k)}</th>`).join('')}</tr>${data.map(r=>`<tr>${ks.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</table></div>`; }
  }
  $('m-form').style.width = '760px'; $('m-form').onsubmit = e => e.preventDefault();
  $('m-form').innerHTML = modalHTML(`Predio ${esc(f.matricula ?? f.id)}`, html + `<button type="button" class="btn ghost" onclick="cerrarModal()">Cerrar</button>`);
  $('modal').hidden = false;
}
$('p-csv').onclick = () => {
  const n = cols.filter(c=>!ocultas.has(c.column_name)).map(c=>c.column_name);
  const csv = [n.join(',')].concat(filas.map(f=>n.map(c=>`"${String(f[c]??'').replace(/"/g,'""')}"`).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); a.download='predios.csv'; a.click();
};

// ── 2. Cargar datos nuevos (CSV / GeoJSON) ──
function parseCSV(txt){
  const rows=[]; let r=[], c='', q=false;
  for (let i=0;i<txt.length;i++){ const ch=txt[i];
    if (q){ if(ch==='"'&&txt[i+1]==='"'){c+='"';i++} else if(ch==='"') q=false; else c+=ch; }
    else if (ch==='"') q=true; else if (ch===','){r.push(c);c=''} else if (ch==='\n'||ch==='\r'){ if(ch==='\r'&&txt[i+1]==='\n')i++; r.push(c);c=''; if(r.some(x=>x!==''))rows.push(r); r=[]; } else c+=ch; }
  if (c||r.length){r.push(c);rows.push(r)}
  const h = rows.shift().map(x=>x.trim().toLowerCase());
  return rows.map(v=>Object.fromEntries(h.map((k,i)=>[k,v[i]===''?null:v[i]])));
}
$('c-file').onchange = async e => {
  const file = e.target.files[0]; if (!file) return; const txt = await file.text(); let rows;
  try {
    if (/\.csv$/i.test(file.name)) rows = parseCSV(txt);
    else rows = JSON.parse(txt).features.map(f=>({...f.properties, geom: f.geometry ? JSON.stringify(f.geometry) : null}));
  } catch(err){ return toast('Archivo no válido: '+err.message); }
  cargaPend = rows.map(r=>{ const o={}; [...CAMPOS,'geom'].forEach(k=>{ const kk=Object.keys(r).find(x=>x.toLowerCase()===k); if(kk&&r[kk]!=null&&r[kk]!=='') o[k]=r[kk]; }); return o; }).filter(o=>o.matricula);
  $('c-prev').innerHTML = `<p><b>${cargaPend.length}</b> predios con matrícula listos para cargar (se descartan filas sin matrícula). Vista previa:</p><div class="scroll"><table><tr>${CAMPOS.map(c=>`<th>${c}</th>`).join('')}</tr>${cargaPend.slice(0,5).map(o=>`<tr>${CAMPOS.map(c=>`<td>${esc(o[c])}</td>`).join('')}</tr>`).join('')}</table></div>`;
  $('c-go').hidden = !cargaPend.length || !puedeEditar();
};
$('c-go').onclick = async () => {
  const t = $('c-tabla').value; let ok=0;
  for (let i=0;i<cargaPend.length;i+=200){
    const {error} = await sb.from(t).insert(cargaPend.slice(i,i+200));
    if (error) return toast(`Se cargaron ${ok}. Error: ${error.message}`); ok += Math.min(200,cargaPend.length-i);
  }
  toast(`${ok} predios cargados en ${t}`); $('c-go').hidden = true; $('c-prev').innerHTML=''; $('c-file').value='';
};

$('c-limpiar').onclick = () => { $('c-file').value=''; $('c-prev').innerHTML=''; $('c-go').hidden=true; cargaPend=[]; };
$('i-limpiar').onclick = () => { $('i-mat').value=''; $('i-form').innerHTML=''; };

// ── 3. Informe: revisar y organizar antes de exportar ──
let infoPredio = null, infoUsos = [], infoTipo = '';
$('i-buscar').onclick = async () => {
  const m = $('i-mat').value.trim(); if (!m) return;
  let {data:p} = await sb.from('urbano').select('id,'+CAMPOS.join(',')).eq('matricula',m).limit(1); infoTipo='Urbano';
  if (!p?.length){ ({data:p} = await sb.from('Rural').select('id,'+CAMPOS.join(',')).eq('matricula',m).limit(1)); infoTipo='Rural'; }
  if (!p?.length) { $('i-form').innerHTML=''; return toast('Matrícula no encontrada'); }
  infoPredio = p[0];
  const {data:u} = infoTipo==='Urbano'
    ? await sb.from('resultado_uso_predio').select('*').eq('predio_id',infoPredio.id).order('porcentaje',{ascending:false})
    : await sb.from('resultado_uso_predio_rural').select('*').eq('matricula',m).order('porcentaje',{ascending:false});
  infoUsos = u || [];
  $('i-form').innerHTML = `<b>Zona: ${infoTipo}</b>` + ['matricula','nup','ficha','direccion','area_terr'].map(c=>`<label>${c}</label><input data-f="${c}" value="${esc(infoPredio[c])}">`).join('') +
    `<label>Usos a incluir en el informe</label>` + infoUsos.map((x,i)=>`<label style="text-transform:none"><input type="checkbox" data-u="${i}" checked> ${esc(x.tipo_suelo)} — ${esc(x.area_m2)} m² (${esc(x.porcentaje)}%)</label>`).join('') +
    `<div><button class="btn" id="i-pdf">Generar informe PDF</button></div><p class="muted">Los campos se pueden ajustar solo para este informe; para cambiar el dato en la base usa la pestaña Predios.</p>`;
  $('i-pdf').onclick = generarPDF;
};
function generarPDF(){
  const v = c => $('i-form').querySelector(`[data-f="${c}"]`).value;
  const usos = [...$('i-form').querySelectorAll('[data-u]:checked')].map(i=>infoUsos[i.dataset.u]);
  const fecha = new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'});
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe Predial — ${esc(v('matricula'))}</title><style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:32px;color:#2d3748}.h{background:linear-gradient(135deg,#1a4fd6,#0e3ab8);color:#fff;padding:22px 28px;border-radius:12px;margin-bottom:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1{margin:0 0 4px;font-size:20px}p{margin:0;font-size:12px;opacity:.8}.l{font-size:11px;font-weight:700;color:#718096;text-transform:uppercase;margin:20px 0 8px}
  table{width:100%;border-collapse:collapse}td,th{padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:left}th{background:#1a4fd6;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .f{margin-top:30px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:12px}</style></head><body>
  <div class="h"><h1>Informe de Consulta Predial</h1><p>Municipio de La Ceja del Tambo · Geo-Ceja · ${fecha} · Zona ${infoTipo}</p></div>
  <div class="l">Información del predio</div><table>${[['Matrícula','matricula'],['NUP','nup'],['Ficha catastral','ficha'],['Dirección','direccion'],['Área catastral (m²)','area_terr']].map(([n,c])=>`<tr><td><b>${n}</b></td><td>${esc(v(c))}</td></tr>`).join('')}</table>
  <div class="l">Usos del suelo</div><table><tr><th>Tipo de suelo</th><th>Área (m²)</th><th>%</th></tr>${usos.map(x=>`<tr><td>${esc(x.tipo_suelo)}</td><td>${esc(x.area_m2)}</td><td>${esc(x.porcentaje)}</td></tr>`).join('')}</table>
  <div class="f">Generado por Geo-Ceja · Alcaldía de La Ceja del Tambo · Observatorio Municipal</div></body></html>`);
  w.document.close(); w.onload = () => { w.focus(); w.print(); };
}

// ── 4. Usuarios (solo superadministrador) ──
async function cargarUsuarios(){
  const {data,error} = await sb.from('perfiles').select('*').order('creado'); if (error) return toast(error.message);
  const R = {admin:'Superadministrador',editor:'Editor',consulta:'Consulta'};
  $('u-tbl').innerHTML = '<tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th></tr>' + data.map(u=>`<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td>
    <td><select data-u="${u.id}" data-k="rol">${Object.keys(R).map(r=>`<option value="${r}" ${u.rol===r?'selected':''}>${R[r]}</option>`).join('')}</select></td>
    <td><input type="checkbox" data-u="${u.id}" data-k="activo" ${u.activo?'checked':''}></td></tr>`).join('');
}
$('u-tbl').onchange = async e => {
  const t = e.target, {error} = await sb.from('perfiles').update({[t.dataset.k]: t.type==='checkbox'?t.checked:t.value}).eq('id',t.dataset.u);
  toast(error ? error.message : 'Usuario actualizado');
};
$('u-limpiar').onclick = () => ['u-nombre','u-email','u-pass'].forEach(i=>$(i).value='');
$('u-crear').onclick = async () => {
  const nombre=$('u-nombre').value.trim(), email=$('u-email').value.trim(), pass=$('u-pass').value;
  if (!email || pass.length<8) return toast('Escribe un correo y una contraseña de mínimo 8 caracteres');
  // Cliente aparte: no toca tu sesión de superadministrador
  const sb2 = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{persistSession:false,autoRefreshToken:false,storageKey:'sb-alta'}});
  const {data,error} = await sb2.auth.signUp({email, password:pass, options:{data:{nombre}}});
  if (error || !data.user) return toast('No se pudo crear: '+(error?.message||'revisa el correo'));
  const {error:e2} = await sb.from('perfiles').update({nombre: nombre||email.split('@')[0], rol:$('u-rol').value, activo:true}).eq('id',data.user.id);
  toast(e2 ? 'Usuario creado pero sin activar: '+e2.message : 'Usuario creado y activado'); $('u-limpiar').onclick(); cargarUsuarios();
};

// ── 5. Campos: crear, mostrar/ocultar, renombrar, eliminar (solo superadministrador) ──
async function verCampos(){
  const t = $('k-tabla').value; await cargarCols(t, true);
  $('k-tbl').innerHTML = '<tr><th>Campo</th><th>Tipo</th><th>Origen</th><th>Visible en Predios</th><th></th></tr>' + cols.map(c=>{
    const n=c.column_name, creado=cfg[n]?.creado, fijo=['id','matricula'].includes(n);
    return `<tr><td><b>${esc(n)}</b></td><td>${TIPOS[c.data_type]||esc(c.data_type)}</td><td><span class="tag ${creado?'new':''}">${creado?'Creado por ti':'Original'}</span></td>
      <td><label class="sw"><input type="checkbox" data-vis="${esc(n)}" ${ocultas.has(n)?'':'checked'} ${fijo?'disabled':''}><span></span></label></td>
      <td>${creado?`<button class="btn ghost" data-ren="${esc(n)}">Renombrar</button> <button class="btn danger" data-del="${esc(n)}">Eliminar</button>`:''}</td></tr>`;
  }).join('');
}
$('k-tabla').onchange = verCampos;
$('k-limpiar').onclick = () => { $('k-nombre').value=''; $('k-ambas').checked=false; };
$('k-tbl').onchange = async e => {
  const n = e.target.dataset.vis; if (!n) return;
  const {error} = await sb.from('campos_config').upsert({tabla:$('k-tabla').value, columna:n, visible:e.target.checked});
  toast(error ? error.message : e.target.checked ? 'Campo visible' : 'Campo oculto'); colsTabla='';
};
$('k-tbl').onclick = async e => {
  const d = e.target.dataset, t = $('k-tabla').value;
  if (d.ren){ const nuevo = slug(prompt(`Nuevo nombre para "${d.ren}":`, d.ren) || ''); if (!nuevo || nuevo===d.ren) return;
    const {error} = await sb.rpc('renombrar_columna',{p_tabla:t,p_viejo:d.ren,p_nuevo:nuevo}); toast(error ? error.message : 'Campo renombrado'); verCampos(); }
  if (d.del){ if (!confirm(`¿Eliminar el campo "${d.del}" y TODOS sus datos? Esta acción no se puede deshacer.`)) return;
    const {error} = await sb.rpc('eliminar_columna',{p_tabla:t,p_nombre:d.del}); toast(error ? error.message : 'Campo eliminado'); verCampos(); }
};
$('k-crear').onclick = async () => {
  const nombre = slug($('k-nombre').value);
  if (!/^[a-z]/.test(nombre)) return toast('El nombre debe empezar con una letra');
  for (const t of ($('k-ambas').checked ? ['urbano','Rural'] : [$('k-tabla').value])){
    const {error} = await sb.rpc('agregar_columna',{p_tabla:t,p_nombre:nombre,p_tipo:$('k-tipo').value});
    if (error) return toast(`${t}: ${error.message}`);
  }
  toast(`Campo "${nombre}" creado`); $('k-limpiar').onclick(); verCampos();
};
init();
