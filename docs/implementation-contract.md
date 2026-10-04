# Salon ERP production candidate implementation contract

Target: single salon internal ERP; external payment-terminal results recorded, not card approval integration. Korean UI. Node 24+, node:sqlite, Express, React18 + Vite. No prototype demo people/data on fresh install.

## Shared state (server-owned)
`{schemaVersion:2, store, staff:[], services:[], customers:[], appointments:[], transactions:[], refunds:[], items:[], receipts:[], logs:[], inventoryOperations:[], seq:{}}`.
IDs opaque strings. Money KRW nonnegative safe integer. Dates YYYY-MM-DD Asia/Seoul. Appointment minutes from midnight. Timestamps ISO.
- store: `{name,phone,address,timeZone:'Asia/Seoul',open:600,close:1200,slotMinutes:30,closedWeekdays:[]}`
- staff: `{id,name,role:'owner'|'manager'|'designer'|'reception',phone,status:'active'|'inactive',workingDays:[0,1,2,3,4,5,6],startMinutes:600,endMinutes:1200,breakStart:null,breakEnd:null}`. User's staffId references this. Staff role for operations must match linked user role; account management handles syncing.
- services: `{id,name,price,duration,materials:[{itemId,quantity}],active:true}`
- customers: `{id,name,phone,memo,warning,createdAt,archived:false}`
- appointments: `{id,date,start,duration,customerId:null,guestName:'',guestPhone:'',staffId,serviceIds:[],notes:'',status:'booked'|'checked_in'|'in_service'|'completed'|'cancelled'|'no_show',transactionId:null,changes:[]}`
- items: existing inventory shape `{id,name,kind:'시술 재료'|'판매 상품',unit:'g'|'ml'|'개',qty,min,price,active:true}`
- receipts/logs/inventoryOperations: use existing `src/inventory.js` API, server ctx actual authenticated actor.
- transactions: `{id,appointmentId:null,customerId:null,customerName,staffId,serviceDate,date,time,lines:[{id,type:'service'|'product',refId,name,unitPrice,quantity,discount,total}],discount,subtotal,total,method:'card'|'cash'|'transfer',reference:'',notes:'',status:'paid'|'partially_refunded'|'refunded',actorId,createdAt,changes:[]}`. lines.discount proportional allocation of transaction discount; lines.total net.
- refunds: `{id,transactionId,date,time,lines:[{lineId,quantity,amount,restock}],amount,method,reference,reason,actorId,createdAt}`. Original transactions and service-consumption logs preserved. Daily settlement uses event date, not original sale date.

## Domain module ownership/export
`server/operations.cjs`: exports `initialState({storeName,ownerName,ownerStaffId}), applyOperation(data,type,payload,ctx)`.
`server/commerce.cjs`: exports `applyCommerce(data,type,payload,ctx), getReport(data,{from,to,staffId?})`.
Each mutation returns NEW state, no database I/O. Throw Error with `status` (400/403/409/422), `code` and message for user. Unknown type throws status400. Server routes based action prefix whitelist, module handles payload constraints and actor ownership. ctx `{actor:{id,name,role,staffId},today:'YYYY-MM-DD',now:'ISO',requestId}`. Reject invalid IDs, amounts, dates, enum values, length; do not trust client snapshots/actor.

Actions (POST /api/actions/:type) body `{payload,version,requestId}` -> `{data,version}`. Strict exact global version compare within DB BEGIN IMMEDIATE; conflict409 before mutation; idempotent actorId+requestId stores response. Client preserves draft on conflict, refreshes state and asks recheck/retry. Same requestId cannot run different payload.
Operations: `customer.save` payload `{id?,name,phone,memo,warning}`; `customer.archive` `{id,archived}`; `appointment.save` `{id?,date,start,duration?,customerId?,guestName?,guestPhone?,staffId,serviceIds,notes}`; `appointment.status` `{id,status,reason?}` (reversal audited; cannot bypass recorded payment); `staff.save` `{id?,name,phone,role,status,workingDays,startMinutes,endMinutes,breakStart,breakEnd}`; `service.save` `{id?,name,price,duration,materials,active}`; `store.save` store fields; `legacy.import` `{data:legacyV2}` (owner only, empty business data only, validate all and preserve stock exactly, no partial import).
Commerce: `payment.create` `{appointmentId?,customerId?,guestName?,staffId,serviceDate?,lines:[{type,refId,quantity,unitPrice?}],discount,method,reference,notes}`; `payment.correct` `{id,staffId?,method?,reference?,reason}` metadata-only, NEVER consumes stock again; amount/line corrections use explicit refund/new extra sale. `payment.refund` `{transactionId,lines:[{lineId,quantity,restock}],method,reference,reason}` amount server calculates remaining quantities+discount; no overrefund, service use stays consumed, products restock only selected quantities. `inventory.receipt` existing `{itemId,qty,date,memo}`; `inventory.correct` `{receiptId,qty,reason,expectedRevision}`; `inventory.cancel` `{receiptId,reason,expectedRevision}`; `inventory.threshold` `{itemId,qty}`; `inventory.adjust` `{itemId,qty,reason}`; `inventory.item` `{id?,name,kind,unit,min,price,active}` creating qty0, receipt/adjust only for qty. `getReport` -> `{from,to,gross,refunds,net,count,byMethod:[{method,gross,refunds,net}],byStaff:[{staffId,name,total,count}],daily:[{date,gross,refunds,net}],transactions,refundEntries}`.

## HTTP contract (foundation agent)
- GET /api/health -> {status:'ok'}
- GET /api/bootstrap -> {needsSetup:boolean,setupAllowed:boolean,requiresToken:boolean}
- POST /api/bootstrap {storeName,name,email,password,setupToken?} -> session object; only empty DB; production requires configured BOOTSTRAP_TOKEN; dev loopback initial setup only.
- GET /api/auth/me -> {user:{id,name,email,role,staffId,mustChangePassword},csrfToken} or401.
- POST /api/auth/login {email,password} -> session object. POST /api/auth/logout ->204; POST /api/auth/password {currentPassword,newPassword} -> session object (rotate session, revoke others).
- GET /api/state -> {data,version}; server filters designer transactions/refunds and appointments to own staffId. Password hashes/users/sessions never in data.
- POST /api/actions/:type as above; csrf via X-CSRF-Token header, credentials same-origin.
- GET /api/reports?from=&to=&staffId= -> report; owner/manager/reception only.
- GET /api/users -> {users:public users[]} owner/manager; POST /api/users {name,email,role,staffId,password} creates account for existing staff. PATCH /api/users/:id {active?,role?,password?}; privilege and last-owner checks; mustChangePassword for admin reset; revoke sessions on changes. Password change required blocks other API.
- GET /api/audit?limit= -> {entries:[{id,at,actorName,action,summary}]} owner/manager.
- GET /api/export?from=&to= -> CSV with safe formula escaping, authenticated financial roles.
- GET /api/backup -> DB snapshot download, owner only.
JSON errors `{error:{code,message,fields?}}` status meaningful. Request size limited, sessions HttpOnly SameSite and Secure production, csrf+Origin validated. Password scrypt with random salt. Rate limits for auth. SQLite transactional state+audit+idempotency.
Roles action permissions: owner all. manager all except legacy.import, store admin account ownership. reception customer/appointment/payment/inventory (except inventory.item) actions; read all necessary cash records. designer only customer.save and own appointment.save/status (server checks staffId), read stock/services and own payments; no payments mutations or inventory mutations/settings/staff/users. UI hides restricted areas but server is source of truth.

Payroll access: owner/manager manage all payroll. Both designer and reception may view/print only their own staffId's finalized or paid payslips; drafts and other employees' payslips are removed from all API state responses. Neither employee role may run any payroll mutation.

## React contract (root owns App/API/ui + Staff/Settings; page agents consume)
Root supplies `src/api.js`: api(path, options={}) fetch /api path (`path` starts '/state', '/auth/me' etc), parses JSON/errors. `getSession`, `setSession` maintained in root; csrf auto. `src/components/ui.jsx` exports `Button`, `Modal`, `Field`, `Badge`, `EmptyState`, `Money`, `ConfirmDialog` (details to follow). Page agents may use native controls with classnames below if uncertain.
All pages default export function `Page({data,user,version,runAction,refresh,notify,navigate})`. `runAction(type,payload,requestId?)` Promise -> returned state envelope, sets root data/version; on conflict refresh state and throw error while preserving local dialog; duplicate double-click disabled in page. A given unchanged attempt retry should reuse requestId; root runAction generates per call unless passed, UI retain same requestId on network failure; root API can maintain signature-based pending IDs. `navigate('appointments'|'customers'|'payments'|'inventory'|'sales'|'staff'|'settings'|'dashboard', {customerId?,appointmentId?,transactionId?})` updates `routeContext` passed to pages as prop.
Page components: `src/pages/Appointments.jsx`, `Customers.jsx` (operations UI agent); `Payments.jsx`, `Inventory.jsx`, `Sales.jsx` (commercial UI agent); root `Dashboard.jsx`, `Staff.jsx`, `Settings.jsx`, `App.jsx` auth shell.
Shared style classes: page-header,page-title,page-description,page-actions,btn,btn-primary,btn-secondary,btn-danger,btn-ghost,card,card-header,card-body,grid,grid-2,grid-3,stat-grid,stat-card,toolbar,field,field-label,input,textarea,select,help,error,alert,alert-warning,alert-success,badge,badge-success,badge-warning,badge-danger,badge-muted,table-wrap,table,empty-state,muted,stack,row,amount,tabs,tab,active. root owns global src/styles.css. Pages may add their own src/pages/<Name>.css if needed, import themselves, avoid overwriting global.
UI date helpers local Intl Asia/Seoul, not UTC split now. Customer warning prominently in appointment/payment. Mobile sidebar drawer, mobile cards for lists. Persistent labels, dirty modal guard, keyboard focus trap, loading/empty/error, no browser alert/prompt/confirm for business actions. Known partial refund & metadata-only corrections explicit UI.
