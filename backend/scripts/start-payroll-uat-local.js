#!/usr/bin/env node
// Route-only local server: skips app.js bot and scheduler startup hooks.
require('dotenv').config({path:require('path').join(__dirname,'../.env.local'),quiet:true});
process.env.NODE_ENV = 'test';
process.env.LOCAL_SUPABASE_TEST_PROFILE = 'payroll';
process.env.USE_DEV_DB = 'false';
process.env.TELEGRAM_MODE = 'disabled';
process.env.TELEGRAM_BOT_TOKEN = '';
const target = require('../src/config/localTestTarget').getLocalTestTarget('payroll');
process.env.SUPABASE_URL = target.apiUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey;
process.env.SUPABASE_TEST_DB_URI = target.dbUri;
const routes = require('../src/app');
const express=require('express');
const app=express();
app.use(express.json());
app.get('/__local-uat',(_req,res)=>res.type('html').send('<h1>Isolated payroll UAT</h1><p>Fake users only. Local database. No external payments.</p>'+['accounts','ho','admin','fm'].map(role=>`<form method="post" action="/__local-uat/login/${role}"><button>Continue as ${role}</button></form>`).join('')));
// Local-only fake-user login. Never mounted by the normal application entrypoint.
app.post('/__local-uat/login/:role', async (req,res,next) => {
 try {
  if(req.get('origin') && !['http://127.0.0.1:5175','http://localhost:5175','http://127.0.0.1:5055'].includes(req.get('origin'))) return res.sendStatus(403);
  if(!['accounts','ho','admin','fm'].includes(req.params.role)) return res.sendStatus(400);
  const fixture=JSON.parse(require('fs').readFileSync('/tmp/local-payroll-uat-fixtures.json','utf8'));
  const id=fixture.users[req.params.role]?.id;
  const {supabase}=require('../src/db/supabase');
  const {data:user,error}=await supabase.from('authorised_users').select('*').eq('id',id).eq('is_active',true).single();
  if(error || !user?.display_name?.startsWith('Synthetic Phase 4')) return res.sendStatus(403);
  const crypto=require('crypto'),service=require('../src/services/session.service');
  const jti=crypto.randomUUID();
  const session=await service.createSession({userId:user.id,jti,userAgent:'Isolated local UAT'});
  const tokens=service.generateTokens(user,session.id,jti);
  res.cookie('accessToken',tokens.accessToken,{httpOnly:true,sameSite:'lax',secure:false});
  res.cookie('refreshToken',tokens.refreshToken,{httpOnly:true,sameSite:'lax',secure:false});
  if(req.accepts('html') && req.get('content-type')!=='application/json') return res.redirect('http://127.0.0.1:5175/hr/payroll/review');
  res.json({success:true,role:user.role,synthetic:true});
 } catch(e){next(e);}
});
app.use(routes);
app.listen(5055, '127.0.0.1', () => {
 console.log('Isolated payroll UAT API: http://127.0.0.1:5055');
 console.log('Database: SNPolymersPayrollTests on localhost:55422. No bot or schedulers started.');
});
