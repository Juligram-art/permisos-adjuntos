'use strict';
const C=window.PermisosCore, $=id=>document.getElementById(id);
let state,blocked=true,role='consultor',view='query',page=1,undo=null,saving=false,loading=false,publicMode=false,publicRequest=0,monthRequest=0;
const cloud=new window.AdjuntosCloud(window.ADJUNTOS_SUPABASE,sessionStorage,fetch.bind(window));
function todayISO(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(t=>p.find(x=>x.type===t).value).join('-');}
const thisYear=Number(todayISO().slice(0,4));let year=thisYear;
function validateState(s){if(!s||s.version!==2||!Number.isInteger(s.revision)||!s.years||typeof s.years!=='object'||!Object.keys(s.years).length)throw Error('Archivo de datos no válido.');for(const [key,d] of Object.entries(s.years)){C.validateYear(d);if(String(d.year)!==key)throw Error('Años incoherentes.');}return s;}
state={version:2,revision:0,years:{[thisYear]:C.defaultYear(thisYear)}};
const data=()=>state.years[year],clone=v=>JSON.parse(JSON.stringify(v)),uid=()=>crypto.randomUUID();
function notice(message,bad=false){$('app-error').hidden=true;$('app-message').hidden=true;const n=$(bad?'app-error':'app-message');n.textContent=message;n.hidden=false;if(bad){n.tabIndex=-1;n.focus();}}
function canEdit(){if(blocked||saving||loading||role!=='editor'){notice(blocked?'Edición bloqueada: no se han podido recuperar los datos.':'Consultor solo permite consultar Permisos.',true);return false;}return true;}
async function commit(next){
  if(!canEdit())return false;
  saving=true;$('app-shell').inert=true;$('sync-status').textContent='Guardando…';
  try {
    validateState(next);
    const changed=Object.keys(next.years).filter(y=>JSON.stringify(next.years[y])!==JSON.stringify(state.years[y]));
    if(changed.length===0){$('sync-status').textContent='Sin cambios';return true;}
    if(changed.length!==1)throw Error('Guarda los cambios de un solo año cada vez.');
    const y=changed[0];
    next.years[y]._revision=await cloud.save(next.years[y],state.years[y]?._revision);
    next.revision=state.revision+1;state=next;
    $('sync-status').textContent='Guardado en Supabase';return true;
  }catch(e){
    blocked=true;notice(e.message+' Pulsa Actualizar datos para comprobar el estado compartido.',true);
    $('sync-status').textContent='Pendiente de actualizar';return false;
  }finally{saving=false;$('app-shell').inert=false;}
}
async function changeYearData(d){const next=clone(state);next.years[year]=d;if(!await commit(next))return false;renderAll();return true;}
function formatDate(day){return C.validDate(day)?new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z')):'Sin seleccionar';}
function options(select,items,placeholder){const previous=select.value;select.replaceChildren();if(placeholder!==null)select.add(new Option(placeholder,''));items.forEach(([v,label])=>select.add(new Option(label,v)));if([...select.options].some(o=>o.value===previous))select.value=previous;}
const staffName=(d,id)=>d.staff.find(s=>s.id===id)?.name||'Adjunto desconocido',reasonCode=(d,id)=>d.reasons.find(r=>r.id===id)?.code||'?';
function renderOptions(){
  options($('year-select'),Object.keys(state.years).sort().reverse().map(y=>[y,y]),null);$('year-select').value=String(year);
  const staff=data().staff.slice().sort((a,b)=>a.name.localeCompare(b.name,'es'));
  options($('staff'),staff.map(s=>[s.id,s.name]),'Selecciona un adjunto');
  options($('reason'),data().reasons.filter(r=>r.active).map(r=>[r.id,r.code===r.label?r.code:`${r.label} · ${r.code}`]),'Selecciona un motivo');
  options($('list-staff'),staff.map(s=>[s.id,s.name]),'Todos');options($('list-reason'),data().reasons.map(r=>[r.id,r.code]),'Todos');
  $('staff-hint').textContent=`${data().staff.length} adjuntos en la plantilla de ${year}. Las altas y bajas determinan la disponibilidad.`;
  for(const id of ['date','end-date','new-staff-from']){$(id).min=`${year}-01-01`;$(id).max=`${year}-12-31`;}
  $('new-staff-from').value=`${year}-01-01`;$('new-year').value=year+1;
}
function updateSummary(){
  $('end-date').setCustomValidity('');let days=[],message='';
  if($('date').value)try{days=C.datesInRange($('date').value,$('end-date').value,$('include-weekends').checked);if(!days.length)message='No hay días: incluye fines de semana o cambia el intervalo.';}catch(e){message=e.message;$('end-date').setCustomValidity(message);}
  $('range-preview').textContent=message||(days.length?`${days.length} días de permiso · ${$('include-weekends').checked?'Incluye fines de semana':'Solo lunes a viernes'}`:'Selecciona la fecha de inicio.');
  $('summary-staff').textContent=$('staff').value?staffName(data(),$('staff').value):'Sin seleccionar';
  $('summary-date').textContent=$('end-date').value?`${formatDate($('date').value)} → ${formatDate($('end-date').value)} · ${days.length} días`:formatDate($('date').value);
  $('summary-reason').textContent=data().reasons.find(r=>r.id===$('reason').value)?.label||'Sin seleccionar';
  const n=[$('staff').value,days.length&&!message,$('reason').value].filter(Boolean).length;$('progress').textContent=`${n} de 3 campos completos`;$('progress-fill').style.width=`${n/3*100}%`;$('error').hidden=true;
}
function renderConsultation(){
  if(publicMode){renderPublicConsultation();return;}
  const today=todayISO(),now=blocked?null:C.daily(state.years[today.slice(0,4)],today);
  $('today-heading').textContent=formatDate(today);$('today-count').textContent=now?now.working:'—';$('today-count').classList.toggle('low-staff',Boolean(now)&&now.working<=5);$('today-roster').textContent=now?`Plantilla activa de ${now.total} adjuntos`:'No hay datos disponibles para el año actual.';
  const day=$('consult-date').value,d=state.years[day.slice(0,4)],result=day&&!blocked?C.daily(d,day):null;
  $('selected-date').textContent=day?formatDate(day):'Selecciona una fecha';$('working-count').textContent=result?result.working:'—';$('working-count').classList.toggle('low-staff',Boolean(result)&&result.working<=5);$('calculation').textContent=result?`${result.total} adjuntos − ${result.absent.length} de permiso`:'';
  $('absent-list').replaceChildren();if(result)result.absent.slice().sort((a,b)=>staffName(d,a.staffId).localeCompare(staffName(d,b.staffId),'es')).forEach(r=>{const li=document.createElement('li');li.textContent=`${staffName(d,r.staffId)} [${reasonCode(d,r.reasonId)}]`;$('absent-list').append(li);});
  $('no-absences').hidden=Boolean(result&&result.absent.length);$('no-absences').textContent=!day?'Selecciona una fecha.':!result?'No hay un archivo disponible para el año consultado.':'No hay permisos registrados para esta fecha.';
}
async function renderMonth(){
  const request=++monthRequest,days=$('calendar-days');days.replaceChildren();
  const anonymous=publicMode;
  $('calendar-year-field').hidden=!anonymous;
  if(!anonymous&&$('calendar-month').dataset.year!==String(year)){
    $('calendar-month').value=year===thisYear?todayISO().slice(5,7):'01';
    $('calendar-month').dataset.year=String(year);
  }
  const selectedYear=anonymous?Number($('calendar-year').value):year;
  $('month-calendar').hidden=true;$('calendar-message').hidden=false;
  if(!C.validYear(selectedYear)){$('calendar-heading').textContent='';$('calendar-message').textContent='Introduce un año entre 1900 y 9999.';return;}
  const month=$('calendar-month').value,first=`${selectedYear}-${month}-01`,start=new Date(first+'T00:00:00Z');
  $('calendar-heading').textContent=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(start);
  $('calendar-message').textContent=anonymous?'Consultando el mes…':'Actualiza los datos para consultar el mes.';
  if(!anonymous&&blocked)return;
  const last=new Date(start);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const dates=C.datesInRange(first,last.toISOString().slice(0,10),true);
  let results;
  try{
    if(anonymous){
      $('sync-status').textContent='Consultando…';
      results=[await cloud.publicDay(first)];
      if(results[0]){
        let cursor=1;
        await Promise.all(Array.from({length:4},async()=>{
          while(cursor<dates.length&&request===monthRequest){const i=cursor++;results[i]=await cloud.publicDay(dates[i]);}
        }));
      }else results=dates.map(()=>null);
    }else results=dates.map(day=>C.daily(state.years[selectedYear],day));
    if(request!==monthRequest||view!=='month'||anonymous!==publicMode)return;
    $('calendar-message').hidden=results.some(Boolean);
    $('calendar-message').textContent='No hay datos disponibles para el año consultado.';
    $('month-calendar').hidden=false;
    if(anonymous){$('sync-status').textContent='Actualizado a las '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});$('cloud-message').hidden=true;}
  }catch(e){
    if(request!==monthRequest||view!=='month')return;
    $('calendar-message').textContent=e.message+' Pulsa Actualizar datos para volver a intentarlo.';
    $('sync-status').textContent='Sin actualizar';return;
  }
  const offset=(start.getUTCDay()+6)%7;
  for(let i=0;i<offset;i++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');days.append(blank);}
  dates.forEach((day,i)=>{
    const result=results[i],button=document.createElement('button');
    button.type='button';button.className='month-day';button.dataset.date=day;
    button.classList.toggle('month-low',Boolean(result)&&result.working<=5);
    button.classList.toggle('month-today',day===todayISO());
    button.setAttribute('aria-label',`${formatDate(day)}: ${result?result.working+' adjuntos trabajando':'sin datos'}. Ver permisos.`);
    if(day===todayISO())button.setAttribute('aria-current','date');
    const date=document.createElement('span'),count=document.createElement('strong'),label=document.createElement('span');
    date.className='month-day-number';date.textContent=String(Number(day.slice(8)));
    count.textContent=result?result.working:'—';label.className='month-day-label';label.textContent=result?'trabajando':'sin datos';
    button.append(date,count,label);
    button.addEventListener('click',()=>{
      if((!publicMode&&blocked)||loading||saving)return;
      $('consult-date').value=day;showView('query');$('consult-date').focus();
    });days.append(button);
  });
}
$('calendar-year').addEventListener('input',renderMonth);
$('calendar-month').addEventListener('change',renderMonth);
for(let m=1;m<=12;m++)$('calendar-month').add(new Option(new Intl.DateTimeFormat('es-ES',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,m-1,1))),String(m).padStart(2,'0')));
function renderList(){
  const d=data(),search=C.normalize($('list-search').value);
  const rows=d.records.filter(r=>(!$('list-month').value||r.date.slice(5,7)===$('list-month').value)&&(!$('list-staff').value||r.staffId===$('list-staff').value)&&(!$('list-reason').value||r.reasonId===$('list-reason').value)&&(!search||C.normalize(staffName(d,r.staffId)+' '+reasonCode(d,r.reasonId)+' '+d.reasons.find(m=>m.id===r.reasonId).label).includes(search))).sort((a,b)=>b.date.localeCompare(a.date)||staffName(d,a.staffId).localeCompare(staffName(d,b.staffId),'es'));
  const pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);$('list-count').textContent=`${rows.length} permisos encontrados de ${d.records.length} en ${year}. Fecha más reciente primero.`;$('record-list').replaceChildren();
  rows.slice((page-1)*20,page*20).forEach(r=>{
    const tr=document.createElement('tr');for(const text of [formatDate(r.date),staffName(d,r.staffId),reasonCode(d,r.reasonId)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
    const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='remove';b.textContent='Quitar';b.setAttribute('aria-label',`Quitar permiso de ${staffName(d,r.staffId)} del ${formatDate(r.date)}`);
    b.addEventListener('click',async()=>{if(!canEdit())return;const next=clone(data());next.records=next.records.filter(x=>x.id!==r.id);if(await changeYearData(next)){undo={year,record:clone(r)};$('undo-delete').hidden=false;notice('Permiso retirado. Puedes deshacer la eliminación.');}});td.append(b);tr.append(td);$('record-list').append(tr);
  });
  $('list-empty').hidden=rows.length>0;$('page-label').textContent=`Página ${page} de ${pages} · 20 por página`;$('previous-page').disabled=page===1;$('next-page').disabled=page===pages;$('undo-delete').hidden=!undo||undo.year!==year;
}
function inputField(form,label,type,value,maxLength){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type=type;input.value=value;if(maxLength)input.maxLength=maxLength;if(type==='date'){input.min=`${year}-01-01`;input.max=`${year}-12-31`;}wrap.append(input);form.append(wrap);return input;}
function renderSettings(){
  $('settings-year').textContent=`Estos cambios afectan solo a ${year}. Los demás años conservan su configuración.`;$('staff-settings').replaceChildren();
  data().staff.forEach(s=>{
    const f=document.createElement('form');f.className='settings-row';f.setAttribute('aria-label',`Modificar adjunto ${s.name}`);
    const name=inputField(f,'Nombre','text',s.name,80),from=inputField(f,'Alta (incluida)','date',s.from),to=inputField(f,'Último día activo (opcional)','date',s.to);name.required=true;from.required=true;
    const b=document.createElement('button');b.type='submit';b.className='secondary';b.textContent='Guardar adjunto';f.append(b);
    f.addEventListener('submit',async e=>{e.preventDefault();if(!canEdit()||!f.reportValidity())return;const next=clone(data());Object.assign(next.staff.find(v=>v.id===s.id),{name:name.value.trim(),from:from.value,to:to.value});if(await changeYearData(next))notice('Adjunto actualizado. El recuento respeta sus fechas de alta y baja.');});$('staff-settings').append(f);
  });
  $('reason-settings').replaceChildren();data().reasons.forEach(r=>{
    const f=document.createElement('form');f.className='settings-row';f.setAttribute('aria-label',`Modificar motivo ${r.code}`);
    const code=inputField(f,'Código','text',r.code,8),label=inputField(f,'Descripción','text',r.label,100);code.required=true;code.pattern='[A-Za-z0-9]{1,8}';label.required=true;if(r.code==='EN'){code.readOnly=true;label.readOnly=true;}
    const wrap=document.createElement('label');wrap.className='weekend-option';const active=document.createElement('input');active.type='checkbox';active.checked=r.active;wrap.append(active,document.createTextNode('Disponible al registrar'));f.append(wrap);
    const b=document.createElement('button');b.type='submit';b.className='secondary';b.textContent='Guardar motivo';f.append(b);
    f.addEventListener('submit',async e=>{e.preventDefault();if(!canEdit()||!f.reportValidity())return;const next=clone(data()),newCode=code.value.trim().toUpperCase();Object.assign(next.reasons.find(v=>v.id===r.id),{code:newCode,label:newCode==='EN'?'EN':label.value.trim(),active:active.checked});if(await changeYearData(next))notice('Motivo actualizado para este año.');});$('reason-settings').append(f);
  });
}
function showView(next){if(role==='consultor'&&!['query','month'].includes(next))next='query';publicRequest++;monthRequest++;view=next;for(const n of ['entry','query','month','list','settings']){$(n+'-view').hidden=n!==view;$(n+'-tab').hidden=role==='consultor'&&!['query','month'].includes(n);$(n+'-tab').setAttribute('aria-pressed',String(n===view));}document.title='Adjuntos · '+({entry:'Entrada_permisos',query:'Permisos',month:'Consulta mensual',list:'Listado',settings:'Configuración'}[view]);if(view==='query')renderConsultation();if(view==='list')renderList();if(view==='month')renderMonth();}
function renderAll(){renderOptions();renderList();renderSettings();updateSummary();showView(view);}
for(const n of ['entry','query','month','list','settings'])$(n+'-tab').addEventListener('click',()=>showView(n));
$('year-select').addEventListener('change',()=>{year=Number($('year-select').value);page=1;$('permission-form').reset();$('consult-date').value=year===thisYear?todayISO():`${year}-01-01`;renderAll();});
const form=$('permission-form');form.addEventListener('input',()=>{updateSummary();$('save-message').hidden=true;});form.addEventListener('change',updateSummary);form.addEventListener('reset',()=>setTimeout(updateSummary,0));
form.addEventListener('submit',async e=>{e.preventDefault();if(!canEdit())return;updateSummary();if(!form.reportValidity())return;try{const days=C.datesInRange($('date').value,$('end-date').value,$('include-weekends').checked),name=staffName(data(),$('staff').value),next=C.addPermissions(data(),$('staff').value,$('reason').value,days,uid);if(!await changeYearData(next))return;$('save-message').textContent=`${days.length} días guardados para ${name} en ${year}. Puedes verlos en Listado.`;$('save-message').hidden=false;form.reset();$('staff').focus();}catch(err){$('error').textContent=err.message;$('error').hidden=false;}});
$('consult-date').value=year===thisYear?todayISO():`${year}-01-01`;$('consult-date').addEventListener('input',renderConsultation);$('go-today').addEventListener('click',()=>{$('consult-date').value=todayISO();renderConsultation();});
for(let m=1;m<=12;m++)$('list-month').add(new Option(new Intl.DateTimeFormat('es-ES',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,m-1,1))),String(m).padStart(2,'0')));
for(const id of ['list-search','list-month','list-staff','list-reason'])$(id).addEventListener('input',()=>{page=1;renderList();});
$('previous-page').addEventListener('click',()=>{page--;renderList();});$('next-page').addEventListener('click',()=>{page++;renderList();});
$('undo-delete').addEventListener('click',async()=>{if(!undo||undo.year!==year||!canEdit())return;const next=clone(data());next.records.push(undo.record);if(await changeYearData(next)){undo=null;renderList();notice('Permiso recuperado.');}});
$('staff-add').addEventListener('submit',async e=>{e.preventDefault();if(!canEdit())return;const next=clone(data());next.staff.push({id:uid(),name:$('new-staff-name').value.trim(),from:$('new-staff-from').value,to:''});if(await changeYearData(next)){$('new-staff-name').value='';notice('Adjunto añadido. La plantilla se actualiza desde su fecha de alta.');}});
$('reason-add').addEventListener('submit',async e=>{e.preventDefault();if(!canEdit())return;const next=clone(data()),code=$('new-reason-code').value.trim().toUpperCase();next.reasons.push({id:uid(),code,label:code==='EN'?'EN':$('new-reason-label').value.trim(),active:true});if(await changeYearData(next)){$('reason-add').reset();notice('Motivo añadido.');}});
$('year-create').addEventListener('submit',async e=>{e.preventDefault();if(!canEdit())return;const n=Number($('new-year').value);if(state.years[n]){notice('Ese año ya existe. Selecciónalo en Año de trabajo; no se ha borrado nada.',true);return;}try{const next=clone(state);next.years[n]=C.createYear(data(),n);if(await commit(next)){year=n;page=1;form.reset();$('consult-date').value=`${year}-01-01`;renderAll();notice(`Año ${year} creado sin permisos. Se conservan los anteriores. Ya puedes descargar el archivo vacío.`);}}catch(err){notice(err.message,true);}});
$('download-year').addEventListener('click',()=>{if(!canEdit())return;const blob=new Blob([JSON.stringify({format:'adjuntos-anual',version:2,data:data()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Permisos_${year}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice(`Se ha solicitado la descarga de Permisos_${year}.json.`);});
$('import-year').addEventListener('change',async()=>{const file=$('import-year').files[0];if(!file||!canEdit())return;try{if(file.size>10*1024*1024)throw Error('El archivo supera los 10 MB.');const loaded=JSON.parse(await file.text());if(loaded.format!=='adjuntos-anual'||loaded.version!==2)throw Error('No es un archivo anual compatible.');const d=C.validateYear(loaded.data);delete d._revision;if(state.years[d.year])throw Error('Ese año ya existe. No se puede sobrescribir.');if(!canEdit())return;if(!confirm(`Se enviarán a Supabase ${d.records.length} permisos y la plantilla de ${d.year}. ¿Importar este archivo para compartirlo con el servicio?`))return;const next=clone(state);next.years[d.year]=d;if(await commit(next)){year=d.year;page=1;$('consult-date').value=`${year}-01-01`;renderAll();notice(`Archivo ${year} recuperado.`);}}catch(err){notice('No se ha importado. '+err.message,true);}finally{$('import-year').value='';}});

function loginScreen(message='Entra con tu cuenta del servicio.') {
  publicMode=false;publicRequest++;monthRequest++;blocked=true;role='consultor';undo=null;document.title='Adjuntos · Acceso';
  state={version:2,revision:0,years:{[thisYear]:C.defaultYear(thisYear)}};
  $('app-shell').hidden=true;$('empty-cloud').hidden=true;$('session-bar').hidden=true;
  $('auth-panel').hidden=false;$('auth-message').textContent=message;
  $('auth-forget').hidden=!cloud.session;$('login-password').value='';
  $('permission-form').reset();$('record-list').replaceChildren();$('absent-list').replaceChildren();
  $('staff-settings').replaceChildren();$('reason-settings').replaceChildren();$('calendar-days').replaceChildren();
  $('staff').replaceChildren();$('reason').replaceChildren();
  $('summary-staff').textContent='Sin seleccionar';$('summary-date').textContent='Sin seleccionar';
  $('summary-reason').textContent='Sin seleccionar';$('today-count').textContent='—';$('working-count').textContent='—';
  $('save-message').hidden=true;$('app-message').hidden=true;$('app-error').hidden=true;
}
async function loadCloud({quiet=false}={}) {
  if(loading||saving)return;loading=true;$('app-shell').inert=true;
  $('refresh-cloud').disabled=true;$('logout').disabled=true;$('sync-status').textContent='Actualizando…';
  try {
    const result=await cloud.load();
    const years=result.years;if(!years||typeof years!=='object'||Array.isArray(years))throw Error('Respuesta de datos no válida.');
    Object.values(years).forEach(C.validateYear);
    publicMode=false;publicRequest++;role=result.role;blocked=false;undo=null;
    $('year-toolbar').hidden=false;$('editor-access').hidden=true;$('logout').hidden=false;
    $('session-label').textContent=`${result.email} · ${role==='editor'?'Editor':'Consultor'}`;
    $('auth-panel').hidden=true;$('session-bar').hidden=false;$('cloud-message').hidden=true;
    $('sync-status').textContent='Actualizado a las '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
    const empty=!Object.keys(years).length;
    $('empty-cloud').hidden=!empty;$('app-shell').hidden=empty;
    state={version:2,revision:0,years:empty?{[thisYear]:C.defaultYear(thisYear)}:years};
    if(empty){
      blocked=true;$('initialize-cloud').hidden=role!=='editor';
      $('empty-message').textContent=role==='editor'?`Todavía no hay años compartidos. Puedes crear ${thisYear} sin permisos, con los 15 adjuntos y los motivos de la plantilla inicial. Los datos locales anteriores no se importan automáticamente.`:'Todavía no hay datos compartidos. Un editor debe preparar el primer año.';
      $('initialize-cloud').textContent=`Crear ${thisYear} con la plantilla inicial`;
    } else {
      if(!state.years[year])year=Number(Object.keys(years).sort().at(-1));
      renderAll();if(!quiet){$('app-error').hidden=true;$('app-message').hidden=true;}
    }
  }catch(e){
    if(!quiet || !cloud.session || e.code==='ACCESS_DENIED'){loginScreen(e.message);}
    else {blocked=true;if(view==='month')renderMonth();$('cloud-message').hidden=false;$('cloud-message').textContent=e.message;}
    $('sync-status').textContent='Sin actualizar';
  }finally{loading=false;$('app-shell').inert=false;$('refresh-cloud').disabled=false;$('logout').disabled=false;}
}
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();if(loading)return;
  const button=e.submitter;button.disabled=true;$('back-public').disabled=true;$('auth-message').textContent='Entrando…';
  try {await cloud.signIn($('login-email').value.trim(),$('login-password').value);$('login-password').value='';view='query';await loadCloud();}
  catch(err){loginScreen(err.message);}finally{button.disabled=false;$('back-public').disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  if(saving||loading)return;const closing=cloud.signOut();publicScreen();await closing;
});
$('auth-forget').addEventListener('click',async()=>{await cloud.signOut();loginScreen();});
$('refresh-cloud').addEventListener('click',()=>publicMode?(view==='month'?renderMonth():renderPublicConsultation()):loadCloud());
$('initialize-cloud').addEventListener('click',async()=>{
  if(saving||loading||role!=='editor')return;
  saving=true;$('initialize-cloud').disabled=true;
  try {await cloud.save(C.defaultYear(thisYear),null);saving=false;await loadCloud();}
  catch(e){$('cloud-message').textContent=e.message;$('cloud-message').hidden=false;}
  finally{saving=false;$('initialize-cloud').disabled=false;}
});
// Keep consultation fresh. Never replace an editor's form while they are typing.
setInterval(()=>{
  if(publicMode&&!document.hidden){if(view==='month')renderMonth();else renderPublicConsultation();return;}
  if(cloud.session&&!document.hidden&&!$('app-shell').hidden&&['query','month'].includes(view))loadCloud({quiet:true});
},60000);
document.addEventListener('visibilitychange',()=>{
  if(publicMode&&!document.hidden){if(view==='month')renderMonth();else renderPublicConsultation();return;}
  if(!document.hidden&&cloud.session&&['query','month'].includes(view))loadCloud({quiet:true});
});
function publicScreen(){
  loginScreen();publicMode=true;view='query';$('calendar-year').value=thisYear;$('calendar-month').value=todayISO().slice(5,7);delete $('calendar-month').dataset.year;
  $('auth-panel').hidden=true;$('session-bar').hidden=false;$('app-shell').hidden=false;
  $('year-toolbar').hidden=true;$('logout').hidden=true;$('editor-access').hidden=false;
  $('session-label').textContent='Consulta abierta · Solo lectura';$('cloud-message').hidden=true;
  showView('query');
}
function paintPublicCounts(now,result,day){
  $('today-heading').textContent=formatDate(todayISO());
  $('today-count').textContent=now?now.working:'—';
  $('today-count').classList.toggle('low-staff',Boolean(now)&&now.working<=5);
  $('today-roster').textContent=now?`Plantilla activa de ${now.total} adjuntos`:'Sin datos disponibles para hoy.';
  $('selected-date').textContent=day?formatDate(day):'Selecciona una fecha';
  $('working-count').textContent=result?result.working:'—';
  $('working-count').classList.toggle('low-staff',Boolean(result)&&result.working<=5);
  $('calculation').textContent=result?`${result.total} adjuntos − ${result.absent.length} de permiso`:'';
  $('absent-list').replaceChildren();
  if(result)for(const person of result.absent){const li=document.createElement('li');li.textContent=`${person.name} [${person.code}]`;$('absent-list').append(li);}
  $('no-absences').hidden=Boolean(result?.absent.length);
  $('no-absences').textContent=!day?'Selecciona una fecha.':!result?'No hay datos disponibles para el año consultado.':'No hay permisos registrados para esta fecha.';
}
async function renderPublicConsultation(){
  const request=++publicRequest,day=$('consult-date').value,today=todayISO();
  paintPublicCounts(null,null,day);$('sync-status').textContent='Consultando…';
  try{
    const [now,result]=await Promise.all([cloud.publicDay(today),C.validDate(day)?(day===today?Promise.resolve(undefined):cloud.publicDay(day)):Promise.resolve(null)]);
    if(!publicMode||request!==publicRequest)return;
    paintPublicCounts(now,day===today?now:result,day);$('cloud-message').hidden=true;
    $('sync-status').textContent='Actualizado a las '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
  }catch(e){
    if(!publicMode||request!==publicRequest)return;
    $('sync-status').textContent='Sin actualizar';$('cloud-message').hidden=false;$('cloud-message').textContent=e.message;
  }
}
$('editor-access').addEventListener('click',()=>{loginScreen();$('cloud-message').hidden=true;});
$('back-public').addEventListener('click',()=>{if(!loading)publicScreen();});
if(cloud.session)loadCloud();else publicScreen();
