const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url); }
      catch (e) { return json({error: e?.message || 'Server error'}, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};

async function api(request, env, url) {
  await ensureAdmin(env);
  const method = request.method;
  const path = url.pathname;

  if (method === 'OPTIONS') return new Response('', {status:204, headers:corsHeaders()});
  if (path === '/api/login' && method === 'POST') return login(request, env);

  const auth = await authenticate(request, env);
  if (!auth) return json({error:'Unauthorized'}, 401);

  if (path === '/api/data' && method === 'GET') return getData(env, auth);
  if (path === '/api/attendance' && method === 'POST') return recordAttendance(request, env, auth);
  if (path === '/api/employees' && method === 'POST') return saveEmployee(request, env, auth);
  if (path.startsWith('/api/employees/') && method === 'DELETE') return deleteEmployee(request, env, auth, path.split('/').pop());
  if (path === '/api/password' && method === 'POST') return changePassword(request, env, auth);
  if (path === '/api/migrate' && method === 'POST') return migrateLocalData(request, env, auth);
  if (path === '/api/health' && method === 'GET') return json({ok:true, database:'D1'});
  return json({error:'Not found'}, 404);
}

function corsHeaders(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...corsHeaders()}})}

async function ensureAdmin(env){
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").first();
  if(!row){
    const hash=await hashPassword('admin123');
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES('admin_password_hash',?)").bind(hash).run();
  }
}

async function login(request, env){
  const body=await request.json();
  const username=String(body.username||'').trim().toLowerCase();
  const password=String(body.password||'');
  if(!username||!password) return json({error:'Enter username and password.'},400);
  if(username==='admin'){
    const row=await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").first();
    if(!row || !(await verifyPassword(password,row.value))) return json({error:'Invalid username or password.'},401);
    const token=await signToken({role:'admin',id:'admin',exp:Date.now()+1000*60*60*12},env);
    return json({token,user:{role:'admin',id:'admin',name:'Admin'}});
  }
  const p=await env.DB.prepare('SELECT id,name,username,position,tag,photo,salary_type,salary_rate,work_days,hours_day,ot_rate,password_hash FROM employees WHERE username=?').bind(username).first();
  if(!p || !(await verifyPassword(password,p.password_hash))) return json({error:'Invalid username or password.'},401);
  const token=await signToken({role:'employee',id:p.id,exp:Date.now()+1000*60*60*12},env);
  return json({token,user:employeePublic(p)});
}

async function authenticate(request,env){
  const h=request.headers.get('Authorization')||'';
  if(!h.startsWith('Bearer ')) return null;
  const payload=await verifyToken(h.slice(7),env);
  if(!payload || payload.exp<Date.now()) return null;
  return payload;
}

async function getData(env,auth){
  const peopleRows=auth.role==='admin'
    ? await env.DB.prepare('SELECT id,name,username,position,tag,photo,salary_type,salary_rate,work_days,hours_day,ot_rate FROM employees ORDER BY name').all()
    : await env.DB.prepare('SELECT id,name,username,position,tag,photo,salary_type,salary_rate,work_days,hours_day,ot_rate FROM employees WHERE id=?').bind(auth.id).all();
  const attendanceRows=auth.role==='admin'
    ? await env.DB.prepare('SELECT id,person_id,name,position,tag,time,type,photo FROM attendance ORDER BY time DESC').all()
    : await env.DB.prepare('SELECT id,person_id,name,position,tag,time,type,photo FROM attendance WHERE person_id=? ORDER BY time DESC').bind(auth.id).all();
  return json({people:peopleRows.results.map(employeePublic),attendance:attendanceRows.results.map(attendancePublic),user:{role:auth.role,id:auth.id}});
}

function employeePublic(p){return {id:p.id,name:p.name,username:p.username,position:p.position||'',tag:p.tag||'',photo:p.photo||'',salaryType:p.salary_type||p.salaryType||'daily',salaryRate:Number(p.salary_rate??p.salaryRate??0),workDays:Number(p.work_days??p.workDays??6),hoursDay:Number(p.hours_day??p.hoursDay??8),otRate:Number(p.ot_rate??p.otRate??0)}}
function attendancePublic(a){return {id:a.id,personId:a.person_id??a.personId,name:a.name,position:a.position||'',tag:a.tag,time:a.time,type:a.type,photo:a.photo||''}}

async function recordAttendance(request,env,auth){
  const body=await request.json();
  const tag=String(body.tag||'').trim();
  if(!tag) return json({error:'Enter an NFC tag ID.'},400);
  const p=await env.DB.prepare('SELECT id,name,position,tag,photo FROM employees WHERE lower(tag)=lower(?)').bind(tag).first();
  if(!p) return json({error:'Unknown NFC tag. Register this employee first.'},404);
  const last=await env.DB.prepare('SELECT type FROM attendance WHERE person_id=? ORDER BY time DESC LIMIT 1').bind(p.id).first();
  const type=last?.type==='IN'?'OUT':'IN';
  const now=new Date().toISOString();
  const id='ATT-'+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO attendance(id,person_id,name,position,tag,time,type,photo,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id,p.id,p.name,p.position||'',p.tag,now,type,p.photo||'',now).run();
  return json({record:{id,personId:p.id,name:p.name,position:p.position||'',tag:p.tag,time:now,type,photo:p.photo||''}});
}

async function saveEmployee(request,env,auth){
  if(auth.role!=='admin') return json({error:'Admin access required.'},403);
  const b=await request.json();
  const id=String(b.id||'').trim();
  const name=String(b.name||'').trim(), username=String(b.username||'').trim().toLowerCase(), position=String(b.position||''), tag=String(b.tag||'').trim();
  const salaryType=b.salaryType==='weekly'?'weekly':'daily', salaryRate=Number(b.salaryRate||0), workDays=Number(b.workDays||6), hoursDay=Number(b.hoursDay||8), otRate=Number(b.otRate||0), photo=String(b.photo||'');
  if(!name||!username||!tag) return json({error:'Name, username and NFC tag are required.'},400);
  if(!Number.isFinite(salaryRate)||salaryRate<=0||!Number.isFinite(otRate)||otRate<0||hoursDay<=0||workDays<=0) return json({error:'Please enter valid salary and work settings.'},400);
  const now=new Date().toISOString();
  try {
    if(id){
      const existing=await env.DB.prepare('SELECT id,password_hash,photo FROM employees WHERE id=?').bind(id).first();
      if(!existing) return json({error:'Employee not found.'},404);
      let hash=existing.password_hash;
      if(b.password) hash=await hashPassword(String(b.password));
      const finalPhoto=photo||existing.photo||'';
      await env.DB.prepare('UPDATE employees SET name=?,username=?,position=?,tag=?,photo=?,salary_type=?,salary_rate=?,work_days=?,hours_day=?,ot_rate=?,password_hash=?,updated_at=? WHERE id=?')
        .bind(name,username,position,tag,finalPhoto,salaryType,salaryRate,workDays,hoursDay,otRate,hash,now,id).run();
    } else {
      if(!b.password) return json({error:'Password is required for a new employee.'},400);
      const newId='EMP-'+crypto.randomUUID();
      const hash=await hashPassword(String(b.password));
      await env.DB.prepare('INSERT INTO employees(id,name,username,password_hash,position,tag,photo,salary_type,salary_rate,work_days,hours_day,ot_rate,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(newId,name,username,hash,position,tag,photo,salaryType,salaryRate,workDays,hoursDay,otRate,now,now).run();
    }
  } catch(e){
    if(String(e.message).toLowerCase().includes('unique')) return json({error:'Username or NFC tag is already registered.'},409);
    throw e;
  }
  return getData(env,auth);
}

async function deleteEmployee(request,env,auth,id){
  if(auth.role!=='admin') return json({error:'Admin access required.'},403);
  await env.DB.prepare('DELETE FROM employees WHERE id=?').bind(id).run();
  return getData(env,auth);
}

async function changePassword(request,env,auth){
  const b=await request.json(); const cur=String(b.currentPassword||''), nw=String(b.newPassword||'');
  if(!cur||!nw) return json({error:'Please complete all password fields.'},400);
  if(nw.length<4) return json({error:'New password must be at least 4 characters.'},400);
  if(auth.role==='admin'){
    const row=await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").first();
    if(!row || !(await verifyPassword(cur,row.value))) return json({error:'Current password is incorrect.'},400);
    await env.DB.prepare("UPDATE settings SET value=? WHERE key='admin_password_hash'").bind(await hashPassword(nw)).run();
  } else {
    const p=await env.DB.prepare('SELECT password_hash FROM employees WHERE id=?').bind(auth.id).first();
    if(!p || !(await verifyPassword(cur,p.password_hash))) return json({error:'Current password is incorrect.'},400);
    await env.DB.prepare('UPDATE employees SET password_hash=?,updated_at=? WHERE id=?').bind(await hashPassword(nw),new Date().toISOString(),auth.id).run();
  }
  return json({ok:true});
}

async function migrateLocalData(request,env,auth){
  if(auth.role!=='admin') return json({error:'Admin access required.'},403);
  const b=await request.json();
  const people=Array.isArray(b.people)?b.people:[], attendance=Array.isArray(b.attendance)?b.attendance:[];
  let peopleImported=0, attendanceImported=0;
  for(const p of people){
    if(!p.name||!p.username||!p.tag) continue;
    const exists=await env.DB.prepare('SELECT id FROM employees WHERE username=? OR lower(tag)=lower(?)').bind(String(p.username).toLowerCase(),String(p.tag)).first();
    if(exists) continue;
    const id=String(p.id||'EMP-'+crypto.randomUUID()), now=new Date().toISOString();
    await env.DB.prepare('INSERT INTO employees(id,name,username,password_hash,position,tag,photo,salary_type,salary_rate,work_days,hours_day,ot_rate,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,p.name,String(p.username).toLowerCase(),await hashPassword(String(p.password||'1234')),p.position||'',p.tag,p.photo||'',p.salaryType==='weekly'?'weekly':'daily',Number(p.salaryRate??p.weeklyRate??650),Number(p.workDays||6),Number(p.hoursDay||8),Number(p.otRate??100),now,now).run();
    peopleImported++;
  }
  for(const a of attendance){
    const exists=await env.DB.prepare('SELECT id FROM attendance WHERE id=?').bind(String(a.id||'')).first();
    if(exists) continue;
    const person=await env.DB.prepare('SELECT id,name,position,tag,photo FROM employees WHERE id=? OR lower(tag)=lower(?)').bind(String(a.personId||''),String(a.tag||'')).first();
    if(!person) continue;
    const id=String(a.id||'ATT-'+crypto.randomUUID()), now=new Date().toISOString();
    await env.DB.prepare('INSERT INTO attendance(id,person_id,name,position,tag,time,type,photo,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id,person.id,person.name,person.position||'',person.tag,a.time,a.type==='OUT'?'OUT':'IN',person.photo||a.photo||'',now).run();
    attendanceImported++;
  }
  return json({ok:true,peopleImported,attendanceImported});
}

async function hashPassword(password){
  const salt=crypto.randomUUID();
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt}$${toB64(new Uint8Array(bits))}`;
}
async function verifyPassword(password,stored){
  const [scheme,it,salt,b64]=String(stored||'').split('$');
  if(scheme!=='pbkdf2'||!salt||!b64) return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:Number(it)||100000,hash:'SHA-256'},key,256));
  return timingSafeEqual(bits,fromB64(b64));
}
function timingSafeEqual(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0}
function toB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
function fromB64(s){s=s.replaceAll('-','+').replaceAll('_','/');while(s.length%4)s+='=';const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
async function signToken(payload,env){const body=toB64(encoder.encode(JSON.stringify(payload)));const sig=await hmac(body,env);return body+'.'+sig}
async function verifyToken(token,env){try{const [body,sig]=String(token).split('.');if(!body||!sig)return null;const expected=await hmac(body,env);if(expected!==sig)return null;return JSON.parse(new TextDecoder().decode(fromB64(body)))}catch{return null}}
async function hmac(data,env){const secret=env.AUTH_SECRET||'CHANGE_ME_BEFORE_PRODUCTION';const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(data));return toB64(new Uint8Array(sig))}
