(function (root) {
  'use strict';
  const names = ['GUILLERMO','JUANA','JULIO','EMILIO','INMA','CARLOS','AIDA','MARIO','GRACIELA','FATIMA','IKER','IVAN','FERNANDO','SILVIA','ALFREDO'];
  const reasons = [['PO','Permiso oficial'],['VA','Vacaciones'],['EN','EN'],['LG','Libranza de guardia'],['PF','Permiso de formación'],['OTR','Otros permisos'],['PC','Permiso de congreso'],['LGS','Libranza de guardia de sábado']];
  const normalize = s => s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  function validDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
  }
  function validYear(year) {return Number.isInteger(Number(year)) && Number(year) >= 1900 && Number(year) <= 9999;}
  function defaultYear(year) {
    if (!validYear(year)) throw Error('Año no válido.');
    return {year:Number(year), staff:names.map((name,i) => ({id:`staff-${i}`,name:name[0]+name.slice(1).toLowerCase(),from:`${year}-01-01`,to:''})),reasons:reasons.map(([code,label]) => ({id:code,code,label,active:true})),records:[]};
  }
  function activeStaff(data,day) {return data.staff.filter(s => s.from <= day && (!s.to || s.to >= day));}
  function datesInRange(start,end,weekends) {
    if (!validDate(start) || !validDate(end || start)) throw Error('Selecciona fechas válidas.');
    end = end || start;
    if (end < start) throw Error('La fecha de fin no puede ser anterior a la de inicio.');
    if (start.slice(0,4) !== end.slice(0,4)) throw Error('Registra por separado los permisos de cada año.');
    const cursor = new Date(start+'T00:00:00Z'), last = new Date(end+'T00:00:00Z'), days = [];
    while(cursor <= last) {
      if (weekends || ![0,6].includes(cursor.getUTCDay())) days.push(cursor.toISOString().slice(0,10));
      cursor.setUTCDate(cursor.getUTCDate()+1);
    }
    return days;
  }
  function validateYear(d) {
    if (!d || !Number.isInteger(d.year) || !validYear(d.year) || !Array.isArray(d.staff) || !Array.isArray(d.reasons) || !Array.isArray(d.records)) throw Error('Archivo anual no válido.');
    const sameYear = day => validDate(day) && Number(day.slice(0,4)) === d.year;
    const ids = items => {const seen=new Set();for (const item of items) {if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) throw Error('Identificadores duplicados o no válidos.');seen.add(item.id);}return seen;};
    const staffIds=ids(d.staff), reasonIds=ids(d.reasons); ids(d.records);
    const staffNames = new Set(), codes = new Set(), pairs = new Set();
    for (const s of d.staff) {
      if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || !sameYear(s.from) || (s.to !== '' && (!sameYear(s.to) || s.to < s.from)) || staffNames.has(normalize(s.name))) throw Error('Revisa los nombres y las fechas de la plantilla.');
      staffNames.add(normalize(s.name));
    }
    for (const r of d.reasons) {
      if (!/^[A-Z0-9]{1,8}$/.test(r.code) || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 100 || typeof r.active !== 'boolean' || codes.has(r.code) || (r.code === 'EN' && r.label !== 'EN')) throw Error('Revisa los códigos y las descripciones de motivos.');
      codes.add(r.code);
    }
    for (const r of d.records) {
      if (!sameYear(r.date) || !staffIds.has(r.staffId) || !reasonIds.has(r.reasonId) || !activeStaff(d,r.date).some(s => s.id === r.staffId)) throw Error('Hay permisos fuera de las fechas de alta del adjunto o del año.');
      const pair = r.staffId+'|'+r.date;
      if (pairs.has(pair)) throw Error('Hay permisos duplicados para una persona y fecha.');
      pairs.add(pair);
    }
    return d;
  }
  function migrate(legacy,currentYear) {
    if (!Array.isArray(legacy)) throw Error('Los datos anteriores no son válidos.');
    const state={version:2,revision:0,years:{}};
    state.years[currentYear]=defaultYear(currentYear);
    for (const r of legacy) {
      if (!r || !validDate(r.date) || typeof r.id !== 'string') throw Error('Hay un registro anterior no válido.');
      const year=r.date.slice(0,4), d=state.years[year] ||= defaultYear(year);
      const s=d.staff.find(s => normalize(s.name) === normalize(r.staff || ''));
      if (!s || !d.reasons.some(v => v.id === r.reason)) throw Error('No se reconoce un adjunto o motivo de los datos anteriores.');
      d.records.push({id:r.id,staffId:s.id,reasonId:r.reason,date:r.date});
    }
    Object.values(state.years).forEach(validateYear);return state;
  }
  function createYear(source,year) {
    if (!validYear(year)) throw Error('Introduce un año entre 1900 y 9999.');
    const d={year:Number(year),staff:activeStaff(source,`${source.year}-12-31`).map(s=>({...s,from:`${year}-01-01`,to:''})),reasons:source.reasons.map(r=>({...r})),records:[]};
    return validateYear(d);
  }
  function addPermissions(data,staffId,reasonId,days,newId) {
    if (!days.length) throw Error('No hay días seleccionados: revisa las fechas o incluye el fin de semana.');
    if (!data.reasons.some(r=>r.id===reasonId && r.active)) throw Error('Selecciona un motivo activo.');
    const conflicts=days.filter(day=>data.records.some(r=>r.staffId===staffId && r.date===day));
    if (conflicts.length) throw Error(`No se ha guardado ningún día. Ya existe permiso en: ${conflicts.join(', ')}.`);
    const next={...data,records:[...days.map(date=>({id:newId(),staffId,reasonId,date})),...data.records]};
    return validateYear(next);
  }
  function daily(data,day) {
    if (!data) return null;
    const staff=activeStaff(data,day), absent=data.records.filter(r=>r.date===day);
    return {total:staff.length,absent,working:staff.length-new Set(absent.map(r=>r.staffId)).size};
  }
  const api={normalize,validDate,validYear,defaultYear,activeStaff,datesInRange,validateYear,migrate,createYear,addPermissions,daily};
  if (typeof module !== 'undefined' && module.exports) module.exports=api; else root.PermisosCore=api;
})(typeof window === 'undefined' ? globalThis : window);
