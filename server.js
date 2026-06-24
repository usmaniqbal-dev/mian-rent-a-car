require('dotenv').config();
const express=require('express'),jwt=require('jsonwebtoken'),path=require('path'),fs=require('fs'),bcrypt=require('bcryptjs');
const app=express(),port=process.env.PORT||3000;
const cloudMode=Boolean(process.env.POSTGRES_URL||process.env.DATABASE_URL);
const databaseUrl=process.env.POSTGRES_URL||process.env.DATABASE_URL;
const dataRoot=process.env.DATA_EXPORT_PATH||'D:\\VS CODE PROJECTS\\Mian Rent A car Projects\\Mian Rent a Car Data';
const stateFile=path.join(dataRoot,'system-state.json');
const secret=process.env.JWT_SECRET||'local_demo_only_change_me';
let savedState=null,revision=0,sql,cloudReady;
const localAccounts={admin:{password:'admin',role:'admin'},admin1:{password:'admin1',role:'super_admin'}};

app.use(express.json({limit:'15mb'}));
if(!cloudMode){fs.mkdirSync(dataRoot,{recursive:true});app.use('/uploads',express.static(path.join(__dirname,'uploads')));app.use(express.static(__dirname));}

function loadStateFromDisk(){try{let disk=JSON.parse(fs.readFileSync(stateFile,'utf8'));savedState=disk.state||null;revision=+disk.revision||0;return true}catch(error){if(error.code!=='ENOENT')console.error('Could not read saved local data:',error.message);return false}}
if(!cloudMode&&loadStateFromDisk())console.log(`Loaded saved data from ${stateFile}`);

async function ensureCloud(){
  if(!cloudMode)return;
  if(cloudReady)return cloudReady;
  cloudReady=(async()=>{
    const {neon}=require('@neondatabase/serverless');sql=neon(databaseUrl);
    await sql`CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, payload JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS app_users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','super_admin')), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    for(const [username,account] of Object.entries(localAccounts)){let hash=await bcrypt.hash(account.password,12);await sql`INSERT INTO app_users (username,password_hash,role) VALUES (${username},${hash},${account.role}) ON CONFLICT (username) DO NOTHING`;}
  })();
  return cloudReady;
}
async function getState(){
  if(!cloudMode){loadStateFromDisk();return {state:savedState,revision};}
  await ensureCloud();let rows=await sql`SELECT payload,revision FROM app_state WHERE state_key='main'`;return rows[0]?{state:rows[0].payload,revision:rows[0].revision}:{state:null,revision:0};
}
function imageExtension(data){return (data.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/)?.[1]||'png').replace('jpeg','jpg').replace(/[^a-z0-9]/gi,'')||'png'}
async function moveImagesToBlob(value,key='file'){
  if(Array.isArray(value))return Promise.all(value.map((item,index)=>moveImagesToBlob(item,`${key}-${index+1}`)));
  if(!value||typeof value!=='object'&&!(typeof value==='string'&&value.startsWith('data:image/')))return value;
  if(typeof value==='object'){let out={};for(const [name,item] of Object.entries(value))out[name]=await moveImagesToBlob(item,name);return out;}
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('Vercel Blob is not configured. Add BLOB_READ_WRITE_TOKEN to Vercel environment variables.');
  const {put}=require('@vercel/blob'),base64=value.split(',')[1],filename=`mian-rent-a-car/${Date.now()}-${safeName(key)}.${imageExtension(value)}`;
  return (await put(filename,Buffer.from(base64,'base64'),{access:'public',token:process.env.BLOB_READ_WRITE_TOKEN})).url;
}
async function saveState(state,expectedRevision=0){
  if(!cloudMode){savedState=state;revision++;fs.writeFileSync(stateFile,JSON.stringify({revision,state:savedState,savedAt:new Date().toISOString()},null,2));return {state:savedState,revision};}
  await ensureCloud();let current=await sql`SELECT revision FROM app_state WHERE state_key='main'`,revisionNow=current[0]?.revision||0;if(revisionNow&&+expectedRevision!==revisionNow){let error=new Error('CONFLICT');error.revision=revisionNow;throw error}let payload=await moveImagesToBlob(state);let newRevision=revisionNow+1;await sql`INSERT INTO app_state (state_key,payload,revision,updated_at) VALUES ('main',${JSON.stringify(payload)}::jsonb,${newRevision},NOW()) ON CONFLICT (state_key) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,updated_at=NOW()`;return {state:payload,revision:newRevision};
}
function safeName(value){return String(value||'unnamed').replace(/[<>:"/\\|?*]+/g,'_').replace(/\.+$/,'').slice(0,100)||'unnamed'}
function auth(req,res,next){try{req.user=jwt.verify(req.headers.authorization?.split(' ')[1],secret);next()}catch{res.status(401).json({message:'Please sign in again'})}}

app.post('/api/auth/login',async(req,res)=>{try{const username=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||'');let account;if(cloudMode){await ensureCloud();let rows=await sql`SELECT username,password_hash,role FROM app_users WHERE username=${username}`;account=rows[0];if(!account||!await bcrypt.compare(password,account.password_hash))return res.status(401).json({message:'Incorrect username or password'});}else{account=localAccounts[username];if(!account||password.toLowerCase()!==account.password)return res.status(401).json({message:'Incorrect username or password'});}res.json({token:jwt.sign({username,role:account.role},secret,{expiresIn:'8h'}),role:account.role,username});}catch(error){console.error(error);res.status(500).json({message:'Login service is unavailable'})}});
app.put('/api/auth/password',auth,async(req,res)=>{try{if(req.user.role!=='super_admin')return res.status(403).json({message:'Only ADMIN1 can change passwords'});const username=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||'');if(!localAccounts[username])return res.status(400).json({message:'Choose admin or ADMIN1'});if(password.length<4)return res.status(400).json({message:'Password must have at least 4 characters'});if(cloudMode){await ensureCloud();await sql`UPDATE app_users SET password_hash=${await bcrypt.hash(password,12)},updated_at=NOW() WHERE username=${username}`;}else{localAccounts[username].password=password.toLowerCase();let adminFolder=path.join(dataRoot,'Admin Setup');fs.mkdirSync(adminFolder,{recursive:true});fs.appendFileSync(path.join(adminFolder,'password-change.log'),`${new Date().toISOString()} — ${req.user.username} changed the password for ${username}\r\n`);}res.json({ok:true});}catch(error){console.error(error);res.status(500).json({message:'Password could not be changed'})}});
app.get('/api/state',auth,async(req,res)=>{try{res.json(await getState())}catch(error){console.error(error);res.status(500).json({message:'Storage is unavailable'})}});
app.put('/api/state',auth,async(req,res)=>{try{let state=req.body?.state;if(!state||typeof state!=='object')return res.status(400).json({message:'A complete record state is required'});let result=await saveState(state,+req.body.revision||0);res.json({ok:true,revision:result.revision,state:result.state});}catch(error){if(error.message==='CONFLICT')return res.status(409).json({message:'Records changed elsewhere. Reload before saving again.',revision:error.revision});console.error(error);res.status(500).json({message:error.message||'Storage save failed'})}});
app.post('/api/export/state',auth,async(req,res)=>{try{if(cloudMode)return res.json({ok:true,mode:'cloud'});let state=req.body?.state||{};await saveState(state,revision);const folders={cars:'Cars',customers:'COUSTOMER',drivers:'DRIVER'};for(const [key,folderName] of Object.entries(folders))for(const record of state[key]||[])writeRecord(path.join(dataRoot,folderName,safeName(key==='cars'?(record.carNumber||record.registrationNumber||record.id):(record.name||record.id))),record);for(const record of state.rentals||[])writeRecord(path.join(dataRoot,record.mode==='without'?'Without Driver rental':'With Driver',safeName(record.customerName||record.id)),record);for(const record of state.expenses||[])writeRecord(record.type==='car'&&record.carNo?path.join(dataRoot,'Cars',safeName(record.carNo),'Expenses',safeName(record.id)):path.join(dataRoot,'Expenses',safeName(record.type),safeName(record.id)),record);writeRecord(path.join(dataRoot,'Admin Setup'),{objects:state.objects||[],fields:state.fields||{},branding:state.branding||{}});res.json({ok:true,location:dataRoot});}catch(error){console.error('Local export failed:',error.message);res.status(500).json({message:'Local export failed'})}});
function writeImages(value,folder,key='image',count={value:0}){if(Array.isArray(value))return value.map((item,index)=>writeImages(item,folder,`${key}-${index+1}`,count));if(!value||typeof value!=='string'||!value.startsWith('data:image/'))return value;let match=value.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.*)$/);if(!match)return value;let filename=`${safeName(key)}-${++count.value}.${imageExtension(value)}`;fs.writeFileSync(path.join(folder,filename),Buffer.from(match[2],'base64'));return filename}
function writeRecord(folder,record){fs.mkdirSync(folder,{recursive:true});let copy=JSON.parse(JSON.stringify(record||{})),count={value:0};for(const key of Object.keys(copy))copy[key]=writeImages(copy[key],folder,key,count);fs.writeFileSync(path.join(folder,'details.json'),JSON.stringify(copy,null,2));fs.writeFileSync(path.join(folder,'details.txt'),Object.entries(copy).filter(([,value])=>typeof value!=='object').map(([key,value])=>`${key}: ${value??''}`).join('\r\n'))}

if(require.main===module)app.listen(port,()=>console.log(`Mian Rent A Car is running on http://localhost:${port} in ${cloudMode?'cloud':'local'} mode`));
module.exports=app;
