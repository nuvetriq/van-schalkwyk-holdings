'use strict';

const express=require('express');
const multer=require('multer');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');

const ROOT=__dirname;
const PORT=Number(process.env.PORT||80);
const DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'data');
const UPLOAD_DIR=path.join(DATA_DIR,'uploads');
const DB_PATH=path.join(DATA_DIR,'holdings.sqlite');
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||'admin';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'';
const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(48).toString('hex');
const COOKIE='vsh_admin';
const TTL=12*60*60*1000;
const BUSINESSES=new Set(['bakery','clever-cubs']);

fs.mkdirSync(UPLOAD_DIR,{recursive:true});
if(!ADMIN_PASSWORD) console.warn('[admin] ADMIN_PASSWORD is not configured.');
if(!process.env.SESSION_SECRET) console.warn('[admin] SESSION_SECRET is ephemeral; sessions reset after restart.');

const db=new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 business TEXT NOT NULL,
 name TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 price_cents INTEGER,
 image_path TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
); CREATE INDEX IF NOT EXISTS idx_products_business ON products(business,active,sort_order,name);`);

const app=express();
app.set('trust proxy',1);
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');if(req.path.startsWith('/admin'))res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');next();});
app.use(express.json({limit:'100kb'}));
app.use(express.urlencoded({extended:false,limit:'100kb'}));
app.use('/assets',express.static(path.join(ROOT,'assets')));
app.use('/uploads',express.static(UPLOAD_DIR));
app.use('/admin',express.static(path.join(ROOT,'admin'),{index:'index.html',maxAge:0}));

function cookies(req){const out={};for(const p of (req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim());}return out;}
function sign(payload){const enc=Buffer.from(JSON.stringify(payload)).toString('base64url');const sig=crypto.createHmac('sha256',SESSION_SECRET).update(enc).digest('base64url');return `${enc}.${sig}`;}
function session(req){const tok=cookies(req)[COOKIE];if(!tok||!tok.includes('.'))return null;const [enc,sig]=tok.split('.',2);const exp=crypto.createHmac('sha256',SESSION_SECRET).update(enc).digest('base64url');const a=Buffer.from(sig),b=Buffer.from(exp);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;try{const p=JSON.parse(Buffer.from(enc,'base64url').toString('utf8'));if(p.exp<Date.now()||p.user!==ADMIN_USERNAME||!p.csrf)return null;return p;}catch{return null;}}
function setCookie(res,s){res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(sign(s))}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${TTL/1000}`);}
function clearCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`);}
function auth(req,res,next){const s=session(req);if(!s)return res.status(401).json({error:'Authentication required.'});req.admin=s;next();}
function csrf(req,res,next){const got=req.get('x-csrf-token')||'',expected=req.admin?.csrf||'';const a=Buffer.from(got),b=Buffer.from(expected);if(!got||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).json({error:'Invalid security token. Refresh and try again.'});next();}
function text(v,n=500){return String(v??'').trim().slice(0,n);}
function input(body){const business=text(body.business,32),name=text(body.name,120),category=text(body.category,80),description=text(body.description,1500);if(!BUSINESSES.has(business))throw Error('Invalid business.');if(!name)throw Error('Product name is required.');if(!category)throw Error('Category is required.');let price_cents=null;if(String(body.price??'').trim()!==''){const p=Number(String(body.price).replace(',','.'));if(!Number.isFinite(p)||p<0)throw Error('Enter a valid price.');price_cents=Math.round(p*100);}const sort_order=Math.max(-9999,Math.min(9999,Number.parseInt(body.sort_order||'0',10)||0));const active=['false','0'].includes(String(body.active))?0:1;return{business,name,category,description,price_cents,sort_order,active};}
function row(r){return{id:r.id,business:r.business,name:r.name,category:r.category,description:r.description,price_cents:r.price_cents,price:r.price_cents==null?null:(r.price_cents/100).toFixed(2),image_url:r.image_path?`/uploads/${path.basename(r.image_path)}`:null,active:Boolean(r.active),sort_order:r.sort_order};}
function delImage(p){if(!p)return;fs.unlink(path.join(UPLOAD_DIR,path.basename(p)),()=>{});}

const upload=multer({storage:multer.diskStorage({destination:(_r,_f,cb)=>cb(null,UPLOAD_DIR),filename:(_r,f,cb)=>{const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}[f.mimetype]||'';cb(null,`${Date.now()}-${crypto.randomUUID()}${ext}`);}}),limits:{fileSize:10*1024*1024,files:1},fileFilter:(_r,f,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/gif'].includes(f.mimetype))});

const attempts=new Map();
app.post('/api/admin/login',(req,res)=>{if(!ADMIN_PASSWORD)return res.status(503).json({error:'Admin login has not been configured yet.'});const ip=req.ip||'unknown',now=Date.now(),a=attempts.get(ip)||{count:0,reset:now+15*60*1000};if(a.reset<now){a.count=0;a.reset=now+15*60*1000;}if(a.count>=5)return res.status(429).json({error:'Too many attempts. Try again later.'});const u=Buffer.from(text(req.body.username,120)),eu=Buffer.from(ADMIN_USERNAME),p=Buffer.from(String(req.body.password||'')),ep=Buffer.from(ADMIN_PASSWORD);const ok=u.length===eu.length&&crypto.timingSafeEqual(u,eu)&&p.length===ep.length&&crypto.timingSafeEqual(p,ep);if(!ok){a.count++;attempts.set(ip,a);return res.status(401).json({error:'Incorrect username or password.'});}attempts.delete(ip);const s={user:ADMIN_USERNAME,csrf:crypto.randomBytes(24).toString('base64url'),exp:Date.now()+TTL};setCookie(res,s);res.json({authenticated:true,user:s.user,csrf:s.csrf});});
app.get('/api/admin/session',(req,res)=>{const s=session(req);res.json(s?{authenticated:true,user:s.user,csrf:s.csrf}:{authenticated:false});});
app.post('/api/admin/logout',auth,csrf,(_req,res)=>{clearCookie(res);res.json({ok:true});});

app.get('/api/products',(req,res)=>{const b=text(req.query.business,32);if(!BUSINESSES.has(b))return res.status(400).json({error:'Invalid business.'});res.json({products:db.prepare('SELECT * FROM products WHERE business=? AND active=1 ORDER BY sort_order,name COLLATE NOCASE').all(b).map(row)});});
app.get('/api/admin/products',auth,(req,res)=>{const b=text(req.query.business,32);if(b&&!BUSINESSES.has(b))return res.status(400).json({error:'Invalid business.'});const rows=b?db.prepare('SELECT * FROM products WHERE business=? ORDER BY sort_order,name COLLATE NOCASE').all(b):db.prepare('SELECT * FROM products ORDER BY business,sort_order,name COLLATE NOCASE').all();res.json({products:rows.map(row)});});
app.post('/api/admin/products',auth,csrf,upload.single('image'),(req,res,next)=>{try{const x=input(req.body),img=req.file?.filename||null;const r=db.prepare('INSERT INTO products(business,name,category,description,price_cents,image_path,active,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(x.business,x.name,x.category,x.description,x.price_cents,img,x.active,x.sort_order);res.status(201).json({product:row(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid))});}catch(e){if(req.file)delImage(req.file.filename);next(e);}});
app.put('/api/admin/products/:id',auth,csrf,upload.single('image'),(req,res,next)=>{try{const id=Number.parseInt(req.params.id,10),old=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!old)return res.status(404).json({error:'Product not found.'});const x=input(req.body);let img=old.image_path;if(String(req.body.remove_image)==='true'){delImage(img);img=null;}if(req.file){delImage(img);img=req.file.filename;}db.prepare('UPDATE products SET business=?,name=?,category=?,description=?,price_cents=?,image_path=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(x.business,x.name,x.category,x.description,x.price_cents,img,x.active,x.sort_order,id);res.json({product:row(db.prepare('SELECT * FROM products WHERE id=?').get(id))});}catch(e){if(req.file)delImage(req.file.filename);next(e);}});
app.delete('/api/admin/products/:id',auth,csrf,(req,res)=>{const id=Number.parseInt(req.params.id,10),old=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!old)return res.status(404).json({error:'Product not found.'});db.prepare('DELETE FROM products WHERE id=?').run(id);delImage(old.image_path);res.json({ok:true});});

function page(file,business){let html=fs.readFileSync(path.join(ROOT,file),'utf8');html=html.replace('</head>','<link rel="stylesheet" href="/assets/products.css"></head>');html=html.replace('</body>',`<script defer src="/assets/public-products.js" data-business="${business}"></script></body>`);html=html.replace(/href=["']bakery-admin\.html["']/g,'href="/admin?business=bakery"').replace(/href=["']clever-cubs-admin\.html["']/g,'href="/admin?business=clever-cubs"');return html;}
app.get(['/','/index.html'],(_q,r)=>r.sendFile(path.join(ROOT,'index.html')));
app.get('/grannys-little-bakery.html',(_q,r)=>r.type('html').send(page('grannys-little-bakery.html','bakery')));
app.get('/clever-cubs-learning.html',(_q,r)=>r.type('html').send(page('clever-cubs-learning.html','clever-cubs')));
app.get('/bakery-admin.html',(_q,r)=>r.redirect('/admin?business=bakery'));
app.get('/clever-cubs-admin.html',(_q,r)=>r.redirect('/admin?business=clever-cubs'));
app.get('/puress.html',(_q,r)=>r.sendFile(path.join(ROOT,'puress.html')));
app.get('/cricut.html',(_q,r)=>r.sendFile(path.join(ROOT,'cricut.html')));
app.get('/healthz',(_q,r)=>r.json({ok:true}));
app.use((req,res)=>req.path.startsWith('/api/')?res.status(404).json({error:'Not found.'}):res.status(404).type('text').send('Not found'));
app.use((err,_req,res,_next)=>{console.error(err);res.status(400).json({error:err.message||'Something went wrong.'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`Van Schalkwyk Holdings listening on ${PORT}`));
