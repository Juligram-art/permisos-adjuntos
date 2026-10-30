/* Cliente de Supabase: sesión en esta pestaña y peticiones HTTPS autenticadas. */
(function(root) {
  'use strict';
  class CloudClient {
    constructor(config, storage, fetcher) {
      this.config=config; this.storage=storage; this.fetcher=fetcher;
      this.key='adjuntos-session-'+new URL(config.url).hostname;
      this.session=null; this.refreshing=null;
      try { this.session=JSON.parse(storage.getItem(this.key)||'null'); } catch { this.clear(); }
    }
    clear() { this.session=null; try { this.storage.removeItem(this.key); } catch {} }
    remember(s) {
      if(!s.access_token || !s.refresh_token || !s.user?.id) throw Error('La sesión recibida no es válida.');
      this.session={access_token:s.access_token,refresh_token:s.refresh_token,
        expires_at:s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600),user:s.user};
      this.storage.setItem(this.key,JSON.stringify(this.session));
    }
    async request(path,{method='GET',body,token}={}) {
      let response;
      try {
        response=await this.fetcher(this.config.url+path, {
          method,headers:{apikey:this.config.publishableKey,'Content-Type':'application/json',
            ...(token?{Authorization:'Bearer '+token}:{})},
          ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)
        });
      } catch { throw Error('No se pudo confirmar la conexión. Comprueba internet y actualiza los datos antes de repetir un guardado.'); }
      const value=await response.json().catch(()=>null);
      if(!response.ok) {
        const message=value?.message||value?.msg||value?.error_description||'Error de conexión.';
        const error=Error(response.status===429?'Demasiados intentos. Espera unos minutos.':
          /Invalid login credentials/i.test(message)?'El correo o la contraseña no son correctos.':
          /Email not confirmed/i.test(message)?'El correo de esta cuenta todavía no está confirmado.':
          value?.code==='PGRST202'?'Falta preparar el guardado compartido. Ejecuta el archivo 02 en SQL Editor.':message);
        error.status=response.status; error.code=value?.code; throw error;
      }
      return value;
    }
    async signIn(email,password) {
      this.clear();
      const result=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
      this.remember(result);
    }
    async token() {
      if(!this.session) throw Error('Inicia sesión para continuar.');
      if(this.session.expires_at < Date.now()/1000+60) {
        if(!this.refreshing) this.refreshing=(async()=>{
          try {this.remember(await this.request('/auth/v1/token?grant_type=refresh_token',{
            method:'POST',body:{refresh_token:this.session.refresh_token}}));}
          catch(e) {if(e.status===400||e.status===401||e.status===403)this.clear();throw e;}
          finally {this.refreshing=null;}
        })();
        await this.refreshing;
      }
      return this.session.access_token;
    }
    async api(path,options={}) {
      const token=await this.token();
      try {return await this.request('/rest/v1/'+path,{...options,token});}
      catch(e) {if(e.status===401)this.clear();throw e;}
    }
    async load() {
      const profiles=await this.api('adjuntos_usuarios?select=perfil,activo&usuario_id=eq.'+encodeURIComponent(this.session.user.id));
      const profile=profiles[0];
      if(!profile?.activo || !['editor','consultor'].includes(profile.perfil)) {
        const error=Error('Tu cuenta no tiene acceso activo. Pide al administrador que te asigne un perfil.');
        error.code='ACCESS_DENIED';throw error;
      }
      const years=await this.api('rpc/adjuntos_leer',{method:'POST',body:{}});
      return {role:profile.perfil,email:this.session.user.email,years};
    }
    async publicDay(day) {
      try {
        return await this.request('/rest/v1/rpc/adjuntos_consulta_publica',{
          method:'POST',body:{dia:day}
        });
      } catch(e) {
        if(e.code==='PGRST202')e.message='La consulta abierta todavía no está activada. Ejecuta el archivo 03 en Supabase. Los editores pueden seguir entrando con su cuenta.';
        throw e;
      }
    }
    async save(data,revision) {
      return this.api('rpc/adjuntos_guardar',{method:'POST',body:{datos:data,revision_esperada:revision??null}});
    }
    async signOut() {
      const token=this.session?.access_token;this.clear();
      if(token)try {await this.request('/auth/v1/logout?scope=local',{method:'POST',token});}catch {}
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=CloudClient;
  else root.AdjuntosCloud=CloudClient;
})(typeof window==='undefined'?globalThis:window);
