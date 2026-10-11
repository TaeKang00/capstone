'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createApp, csvCell } = require('../server/app.cjs');
const { readState, writeState } = require('../server/db.cjs');
const { DatabaseSync } = require('node:sqlite');
const PASSWORD = 'test-password-strong-2026';

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'salon-api-test-'));
  const failures = [];
  const service = createApp({ dbPath:path.join(directory,'test.sqlite'),distPath:directory,onError:error => failures.push(error),...options });
  const server = service.app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); service.close(); fs.rmSync(directory,{ recursive:true,force:true }); assert.deepEqual(failures,[],'Unexpected server errors'); });
  async function request(route,{ method='GET',body,session,headers={} }={}) {
    const response = await fetch(`${base}/api${route}`,{ method, headers:{ ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...(session?.cookie ? { Cookie:session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token':session.csrfToken } : {}), ...(session?.accessToken ? { 'X-Private-Token':session.accessToken } : {}),...headers },body:body === undefined ? undefined : JSON.stringify(body) });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : await response.text();
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { status:response.status,data,headers:response.headers,...(cookie ? { cookie } : {}) };
  }
  async function setup() {
    const response = await request('/bootstrap',{ method:'POST',body:{ storeName:'테스트 미용실',name:'원장',email:'owner@example.com',password:PASSWORD,...(options.bootstrapToken ? { setupToken:options.bootstrapToken } : {}) },headers:options.production ? { Origin:options.origin } : {} });
    assert.equal(response.status,201,JSON.stringify(response.data));
    const session = { ...response.data,cookie:response.cookie };
    const privateAccess = await request('/auth/private/unlock',{ method:'POST',session,body:{ scope:'owner',email:session.user.email,password:PASSWORD },headers:options.production ? { Origin:options.origin } : {} });
    assert.equal(privateAccess.status,200,JSON.stringify(privateAccess.data));
    return { ...session,accessToken:privateAccess.data.accessToken };
  }
  async function state(session) { const result = await request('/state',{ session }); assert.equal(result.status,200,JSON.stringify(result.data)); return result.data; }
  async function action(session,type,payload,extra={}) {
    const { version } = await state(session);
    return request(`/actions/${type}`,{ method:'POST',session,body:{ payload,version,requestId:randomUUID(),...extra } });
  }
  return { ...service,request,setup,state,action,base,directory };
}
async function addAccount(f,owner,role,email=`${role}@example.com`) {
  const staff = await f.action(owner,'staff.save',{ name:role,phone:'',role,status:'active',workingDays:[0,1,2,3,4,5,6],startMinutes:600,endMinutes:1200,breakStart:null,breakEnd:null });
  assert.equal(staff.status,200,JSON.stringify(staff.data));
  const staffId = staff.data.data.staff.at(-1).id;
  const created = await f.request('/users',{ method:'POST',session:owner,body:{ name:role,email,role,staffId,password:PASSWORD } });
  assert.equal(created.status,201,JSON.stringify(created.data));
  const login = await f.request('/auth/login',{ method:'POST',body:{ email,password:PASSWORD } });
  assert.equal(login.status,200);
  const session = { ...login.data,cookie:login.cookie };
  const changed = await f.request('/auth/password',{ method:'POST',session,body:{ currentPassword:PASSWORD,newPassword:`${PASSWORD}-changed` } });
  assert.equal(changed.status,200);
  return { ...changed.data,cookie:changed.cookie,staffId };
}

test('bootstrap creates empty server-owned shop with hashed password and secure session properties',async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/bootstrap')).data,{ needsSetup:true,setupAllowed:true,requiresToken:false });
  const owner = await f.setup();
  const state = await f.state(owner);
  assert.equal(state.data.store.name,'테스트 미용실'); assert.equal(state.version,1);
  for (const field of ['customers','appointments','transactions','items','payroll']) assert.deepEqual(state.data[field],[]);
  assert.equal(state.data.staff.length,1);
  const saved = f.db.prepare('SELECT password_hash FROM users').get(); assert.ok(saved.password_hash.startsWith('scrypt$')); assert.ok(!saved.password_hash.includes(PASSWORD));
  const login = await f.request('/auth/login',{ method:'POST',body:{ email:'OWNER@example.com',password:PASSWORD } });
  assert.match(login.headers.get('set-cookie'),/HttpOnly/); assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await f.request('/bootstrap',{ method:'POST',body:{} })).status,409);
  assert.equal((await f.request('/state')).status,401);
  assert.equal((await f.request('/auth/login',{ method:'POST',body:{ email:'owner@example.com',password:'wrong' } })).status,401);
});

test('production requires HTTPS configuration and installation token; cookies are Secure',async t => {
  assert.throws(() => createApp({ production:true,origin:'http://example.com',dbPath:':memory:' }),/HTTPS/);
  const f = await fixture(t,{ production:true,origin:'https://salon.example.com',bootstrapToken:'this-is-an-unguessable-bootstrap-token' });
  assert.equal((await f.request('/bootstrap')).data.requiresToken,true);
  const denied = await f.request('/bootstrap',{ method:'POST',headers:{ Origin:'https://salon.example.com' },body:{ storeName:'x',name:'x',email:'a@example.com',password:PASSWORD } });
  assert.equal(denied.status,403);
  const owner = await f.setup();
  const login = await f.request('/auth/login',{ method:'POST',headers:{ Origin:'https://salon.example.com' },body:{ email:owner.user.email,password:PASSWORD } });
  assert.match(login.headers.get('set-cookie'),/Secure/); assert.equal(login.headers.get('strict-transport-security'),'max-age=31536000');
  const wrongOrigin = await f.request('/auth/login',{ method:'POST',headers:{ Origin:f.base },body:{ email:owner.user.email,password:PASSWORD } });
  assert.equal(wrongOrigin.status,403);
});

test('mutations reject missing CSRF token and foreign Origin without changing version',async t => {
  const f = await fixture(t); const owner = await f.setup(); const initial = await f.state(owner);
  const body = { payload:{ name:'고객' },version:initial.version,requestId:randomUUID() };
  assert.equal((await f.request('/actions/customer.save',{ method:'POST',body,session:{ cookie:owner.cookie } })).status,403);
  assert.equal((await f.request('/actions/customer.save',{ method:'POST',body,session:owner,headers:{ Origin:'https://evil.example' } })).status,403);
  assert.equal((await f.state(owner)).version,initial.version);
});

test('atomic version check stops lost updates; request replay commits once and rejects payload changes',async t => {
  const f = await fixture(t); const owner = await f.setup(); const { version } = await f.state(owner);
  const requestId = randomUUID(); const payload = { name:'신규 고객',phone:'01012345678',memo:'',warning:'' };
  const body = { payload,version,requestId };
  const first = await f.request('/actions/customer.save',{ method:'POST',body,session:owner }); assert.equal(first.status,200);
  const replay = await f.request('/actions/customer.save',{ method:'POST',body,session:owner }); assert.equal(replay.status,200); assert.equal(replay.data.data.customers.length,1);
  const reused = await f.request('/actions/customer.save',{ method:'POST',body:{ ...body,payload:{ ...payload,name:'다른 고객' } },session:owner }); assert.equal(reused.status,409); assert.equal(reused.data.error.code,'REQUEST_ID_REUSED');
  const stale = await f.request('/actions/customer.save',{ method:'POST',body:{ ...body,requestId:randomUUID(),payload:{ name:'다른 고객' } },session:owner }); assert.equal(stale.status,409); assert.equal(stale.data.error.code,'VERSION_CONFLICT');
  const current = await f.state(owner);
  const concurrent = await Promise.all(['동시1','동시2'].map(name => f.request('/actions/customer.save',{ method:'POST',session:owner,body:{ payload:{ name },version:current.version,requestId:randomUUID() } })));
  assert.deepEqual(concurrent.map(x => x.status).sort(),[200,409]);
  assert.equal((await f.state(owner)).data.customers.length,2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='customer.save'").get().n,2);
});

test('password change rotates session and revokes other devices',async t => {
  const f = await fixture(t); const owner = await f.setup();
  const another = await f.request('/auth/login',{ method:'POST',body:{ email:owner.user.email,password:PASSWORD } });
  const result = await f.request('/auth/password',{ method:'POST',session:owner,body:{ currentPassword:PASSWORD,newPassword:`${PASSWORD}-new` } }); assert.equal(result.status,200);
  assert.notEqual(result.cookie,owner.cookie); assert.notEqual(result.data.csrfToken,owner.csrfToken);
  assert.equal((await f.request('/auth/me',{ session:owner })).status,401);
  assert.equal((await f.request('/auth/me',{ session:{ ...another.data,cookie:another.cookie } })).status,401);
  assert.equal((await f.request('/auth/me',{ session:{ ...result.data,cookie:result.cookie } })).status,200);
});

test('temporary account blocks state until password changed and disabling revokes sessions',async t => {
  const f = await fixture(t); const owner = await f.setup();
  const staff = await f.action(owner,'staff.save',{ name:'접수',phone:'',role:'reception',status:'active',workingDays:[1,2,3,4,5],startMinutes:600,endMinutes:1200,breakStart:null,breakEnd:null });
  const created = await f.request('/users',{ method:'POST',session:owner,body:{ name:'접수',email:'desk@example.com',role:'reception',staffId:staff.data.data.staff.at(-1).id,password:PASSWORD } });
  assert.equal(created.status,201);
  const login = await f.request('/auth/login',{ method:'POST',body:{ email:'desk@example.com',password:PASSWORD } });
  const desk = { ...login.data,cookie:login.cookie };
  assert.equal(desk.user.mustChangePassword,true);
  const blocked = await f.request('/state',{ session:desk }); assert.equal(blocked.status,403); assert.equal(blocked.data.error.code,'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await f.request('/auth/me',{ session:desk })).status,200);
  const disabled = await f.request(`/users/${created.data.user.id}`,{ method:'PATCH',session:owner,body:{ active:false } }); assert.equal(disabled.status,200);
  assert.equal((await f.request('/auth/me',{ session:desk })).status,401);
});

test('designer work state hides payroll; personal reauthentication reveals own finalized slips only',async t => {
  const f = await fixture(t); const owner = await f.setup(); const designer = await addAccount(f,owner,'designer');
  const current = readState(f.db);
  current.data.transactions = [{ id:'own',staffId:designer.staffId,total:1000 },{ id:'other',staffId:owner.user.staffId,total:2000 }];
  current.data.refunds = [{ id:'r-own',transactionId:'own' },{ id:'r-other',transactionId:'other' }];
  current.data.appointments = [{ id:'a-own',staffId:designer.staffId },{ id:'a-other',staffId:owner.user.staffId }];
  current.data.payroll = [{ id:'p-own',staffId:designer.staffId,status:'finalized' },{ id:'p-draft',staffId:designer.staffId,status:'draft' },{ id:'p-other',staffId:owner.user.staffId,status:'paid' }];
  current.data.legacyArchive = { private:'legacy salary and full sales' }; writeState(f.db,current.data,current.version+1);
  const state = await f.state(designer);
  assert.deepEqual(state.data.transactions.map(x => x.id),['own']); assert.deepEqual(state.data.refunds.map(x => x.id),['r-own']); assert.deepEqual(state.data.appointments.map(x => x.id),['a-own']); assert.deepEqual(state.data.payroll,[]);
  const unlocked = await f.request('/auth/private/unlock',{ method:'POST',session:designer,body:{ scope:'personal',email:designer.user.email,password:`${PASSWORD}-changed` } });
  assert.equal(unlocked.status,200);
  const personal = await f.request('/personal/state',{ session:{ ...designer,accessToken:unlocked.data.accessToken } });
  assert.deepEqual(personal.data.data.payroll.map(x => x.id),['p-own']); assert.equal(state.data.legacyArchive,undefined);
  assert.equal((await f.state(owner)).data.legacyArchive,undefined);
  for (const endpoint of ['/users','/audit','/reports','/backup','/export']) assert.equal((await f.request(endpoint,{ session:designer })).status,403,endpoint);
  for (const [type,payload] of [['payment.create',{}],['inventory.receipt',{}],['payroll.save',{}],['appointment.status',{ id:'a-other',status:'cancelled' }]]) assert.equal((await f.action(designer,type,payload)).status,403,type);
});

test('reception payroll requires personal authentication; managers cannot manage accounts or wages',async t => {
  const f = await fixture(t); const owner = await f.setup(); const manager = await addAccount(f,owner,'manager'); const reception = await addAccount(f,owner,'reception');
  const current = readState(f.db);
  current.data.payroll = [
    { id:'p-other',staffId:owner.user.staffId,status:'paid',netPay:999 },
    { id:'p-own-final',staffId:reception.staffId,status:'finalized',netPay:100 },
    { id:'p-own-paid',staffId:reception.staffId,status:'paid',netPay:200 },
    { id:'p-own-draft',staffId:reception.staffId,status:'draft',netPay:300 },
  ];
  current.data.payrolls = structuredClone(current.data.payroll);
  writeState(f.db,current.data,current.version+1);
  const filtered = (await f.state(reception)).data;
  assert.deepEqual(filtered.payroll,[]);
  assert.deepEqual(filtered.payrolls,[]);
  const unlocked = await f.request('/auth/private/unlock',{ method:'POST',session:reception,body:{ scope:'personal',email:reception.user.email,password:`${PASSWORD}-changed` } });
  assert.equal(unlocked.status,200);
  const personal = await f.request('/personal/state',{ session:{ ...reception,accessToken:unlocked.data.accessToken } });
  assert.deepEqual(personal.data.data.payroll.map(x => x.id),['p-own-final','p-own-paid']);
  assert.deepEqual(personal.data.data.payrolls.map(x => x.id),['p-own-final','p-own-paid']);
  for (const type of ['payroll.save','payroll.finalize','payroll.reopen','payroll.paid']) assert.equal((await f.action(reception,type,{ id:'p-own-final' })).status,403,type);
  assert.equal((await f.action(reception,'inventory.item',{})).status,403);
  assert.equal((await f.request(`/users/${manager.user.id}`,{ method:'PATCH',session:manager,body:{ role:'owner' } })).status,403);
  const ownerStaff = (await f.state(owner)).data.staff.find(x => x.id === owner.user.staffId);
  assert.equal((await f.action(manager,'staff.save',{ ...ownerStaff,name:'탈취' })).status,403);
  assert.equal((await f.request(`/users/${owner.user.id}`,{ method:'PATCH',session:manager,body:{ password:`${PASSWORD}-reset` } })).status,403);
});

test('account role changes synchronize staff and invalidate old sessions; self disabling rejected',async t => {
  const f = await fixture(t); const owner = await f.setup(); const designer = await addAccount(f,owner,'designer');
  const changed = await f.request(`/users/${designer.user.id}`,{ method:'PATCH',session:owner,body:{ role:'reception' } }); assert.equal(changed.status,200);
  assert.equal((await f.state(owner)).data.staff.find(x => x.id === designer.staffId).role,'reception');
  assert.equal((await f.request('/state',{ session:designer })).status,401);
  assert.equal((await f.request(`/users/${owner.user.id}`,{ method:'PATCH',session:owner,body:{ active:false } })).status,409);
});

test('backup is valid SQLite snapshot and export escapes spreadsheet formulas',async t => {
  assert.equal(csvCell('  =1+1'), '"\'  =1+1"');
  const f = await fixture(t); const owner = await f.setup();
  const current = readState(f.db); current.data.transactions = [{ id:'sale',customerName:'=HYPERLINK("bad")',date:'2026-09-01',staffId:owner.user.staffId,method:'cash',total:1000,status:'paid',lines:[] }]; writeState(f.db,current.data,current.version+1);
  const exported = await f.request('/export?from=2026-09-01&to=2026-09-01',{ session:owner }); assert.equal(exported.status,200); assert.match(exported.data,/'=HYPERLINK/);
  const response = await fetch(`${f.base}/api/backup`,{ headers:{ Cookie:owner.cookie,'X-Private-Token':owner.accessToken } }); assert.equal(response.status,200);
  const backupPath = path.join(f.directory,'download.sqlite'); fs.writeFileSync(backupPath,Buffer.from(await response.arrayBuffer()));
  const snapshot = new DatabaseSync(backupPath,{ readOnly:true }); assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok'); assert.equal(JSON.parse(snapshot.prepare('SELECT data FROM app_state').get().data).transactions.length,1); snapshot.close();
});

test('login throttles repeated attempts',async t => {
  const f = await fixture(t); await f.setup();
  let result;
  for (let n=0;n<16;n++) result = await f.request('/auth/login',{ method:'POST',body:{ email:'missing@example.com',password:'invalid' } });
  assert.equal(result.status,429);
});

test('username admin authenticates local demo login and owner reauthentication; production still requires a strong password', async t => {
  const f = await fixture(t);
  const created = await f.request('/bootstrap', {method:'POST', body:{storeName:'시연 매장',name:'원장',loginId:'admin',password:'admin'}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.user.loginId,'admin');
  const login = await f.request('/auth/login',{method:'POST',body:{loginId:' ADMIN ',password:'admin'}});
  assert.equal(login.status,200);
  const session = {...login.data,cookie:login.cookie};
  const unlock = await f.request('/auth/private/unlock',{method:'POST',session,body:{scope:'owner',loginId:'admin',password:'admin'}});
  assert.equal(unlock.status,200);
  assert.equal((await f.request('/users',{session:{...session,accessToken:unlock.data.accessToken}})).status,200);
  const stored = f.db.prepare('SELECT password_hash FROM users WHERE email=?').get('admin').password_hash;
  assert.ok(stored.startsWith('scrypt$')); assert.ok(!stored.includes('admin'));
  assert.equal((await f.request('/auth/login',{method:'POST',body:{loginId:'admin',password:'wrong'}})).status,401);
  const prod = await fixture(t,{production:true,origin:'https://salon.example.com',bootstrapToken:'production-bootstrap-secret-2026'});
  const weak = await prod.request('/bootstrap',{method:'POST',headers:{Origin:'https://salon.example.com'},body:{storeName:'운영 매장',name:'원장',loginId:'admin',password:'admin',setupToken:'production-bootstrap-secret-2026'}});
  assert.equal(weak.status,422); assert.equal(weak.data.error.code,'INVALID_PASSWORD');
  assert.equal(prod.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});

test('demo setup preserves business records and other employees, revokes old owner sessions, and never resets an existing password on restart', async t => {
  const {configureDemoAccount} = require('../server/demo.cjs');
  const {hashPassword,verifyPassword} = require('../server/auth.cjs');
  const f = await fixture(t); const owner = await f.setup();
  const employee = await addAccount(f,owner,'designer','staff01');
  const saved = await f.action(owner,'customer.save',{name:'보존할 고객',phone:'01012345678',memo:'방문 기록',warning:''});
  assert.equal(saved.status,200);
  const before = readState(f.db);
  const changed = await configureDemoAccount(f.db,{resetExisting:true});
  assert.equal(changed.userId,owner.user.id);
  assert.equal((await f.request('/state',{session:owner})).status,401);
  assert.equal((await f.request('/state',{session:employee})).status,200);
  const current = readState(f.db);
  assert.deepEqual(current.data.customers,before.data.customers);
  assert.deepEqual(current.data.staff,before.data.staff);
  assert.equal(current.version,before.version+1);
  const hash = await hashPassword('custom-owner-password-2026');
  f.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,owner.user.id);
  assert.equal((await configureDemoAccount(f.db)).changed,false);
  assert.equal(await verifyPassword('admin',f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(owner.user.id).password_hash),false);
  assert.equal((await f.request('/auth/login',{method:'POST',body:{loginId:'admin',password:'custom-owner-password-2026'}})).status,200);
});

test('demo setup cannot take over an employee admin ID, and username validation rejects malformed IDs', async t => {
  const {configureDemoAccount} = require('../server/demo.cjs');
  const f = await fixture(t); const owner = await f.setup();
  await addAccount(f,owner,'designer','admin');
  const original = f.db.prepare('SELECT email,password_hash FROM users WHERE id=?').get(owner.user.id);
  await assert.rejects(configureDemoAccount(f.db,{resetExisting:true}),/다른 직원/);
  assert.deepEqual(f.db.prepare('SELECT email,password_hash FROM users WHERE id=?').get(owner.user.id),original);
  assert.equal((await f.request('/auth/login',{method:'POST',body:{email:original.email,password:PASSWORD}})).status,200);
  const empty = await fixture(t);
  for (const loginId of ['a','staff name','ab/cd','<admin>']) {
    const response = await empty.request('/bootstrap',{method:'POST',body:{storeName:'매장',name:'원장',loginId,password:PASSWORD}});
    assert.equal(response.status,422); assert.equal(response.data.error.code,'INVALID_LOGIN_ID');
  }
  assert.equal(empty.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});

test("procurement API persists relational orders, rejects repeated and stale mutations and protects management permissions", async (t) => {
  const f = await fixture(t),
    owner = await f.setup();
  let r = await f.action(owner, "supplier.save", {
    name: "발주 공급사",
    contact: "담당자",
    phone: "010-0000-0000",
    note: "",
    active: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const supplierId = r.data.data.suppliers[0].id;
  r = await f.action(owner, "category.save", {
    name: "염색 제품",
    active: true,
  });
  assert.equal(r.status, 200);
  const categoryId = r.data.data.itemCategories.find(
    (c) => c.name === "염색 제품",
  ).id;
  r = await f.action(owner, "inventory.item", {
    name: "용량 재료",
    kind: "시술 재료",
    unit: "ml",
    packSize: 500,
    purchasePrice: 12000,
    supplierId,
    categoryId,
    min: 100,
    price: 0,
    active: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const itemId = r.data.data.items[0].id;
  r = await f.action(owner, "purchase.create", {
    supplierId,
    date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
      new Date(),
    ),
    lines: [{ itemId, quantity: 3, unitCost: 12000 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const order = r.data.data.purchaseOrders[0],
    version = r.data.version,
    requestId = randomUUID();
  const payload = {
    id: order.id,
    date: order.date,
    lines: [{ lineId: order.lines[0].id, quantity: 1 }],
  };
  r = await f.request("/actions/purchase.receive", {
    method: "POST",
    session: owner,
    body: { version, requestId, payload },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.data.items[0].qty, 500);
  const duplicate = await f.request("/actions/purchase.receive", {
    method: "POST",
    session: owner,
    body: { version, requestId, payload },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.data.items[0].qty, 500);
  assert.equal(duplicate.data.data.receipts.length, 1);
  const stale = await f.request("/actions/purchase.receive", {
    method: "POST",
    session: owner,
    body: { version, requestId: randomUUID(), payload },
  });
  assert.equal(stale.status, 409);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM purchase_orders").get().n,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT pack_size FROM purchase_order_lines").get().pack_size,
    500,
  );
  assert.equal(
    JSON.parse(f.db.prepare("SELECT data FROM app_state").get().data)
      .purchaseOrders,
    undefined,
  );
  const desk = await addAccount(f, owner, "reception");
  assert.equal((await f.action(desk, "purchase.create", {})).status, 403);
  assert.equal(
    (
      await f.action(desk, "purchase.payment", {
        id: order.id,
        paid: true,
        paidDate: order.date,
        reason: "이체",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.action(desk, "purchase.receive", {
        ...payload,
        lines: [{ lineId: order.lines[0].id, quantity: 2 }],
      })
    ).status,
    200,
  );
  const designer = await addAccount(f, owner, "designer");
  const designerState = await f.state(designer);
  assert.deepEqual(designerState.data.purchaseOrders, []);
  assert.deepEqual(designerState.data.suppliers, []);
  assert.equal(
    (await f.action(designer, "purchase.receive", payload)).status,
    403,
  );
  const before = readState(f.db);
  assert.equal(before.data.items[0].qty, 1500);
  const over = await f.action(owner, "purchase.receive", payload);
  assert.equal(over.status, 422);
  assert.deepEqual(readState(f.db), before);
});
