import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// Real PostgreSQL engine, isolated in memory. The canonical creation function was
// read via CLI on 2026-09-04; the schema contains only this checkout's dependencies.
const postgres = process.argv.includes('--postgres');
const connectionString = process.env.PG_TEST_URL;
if (postgres) {
  const target = new URL(connectionString ?? '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.startsWith('/zelomenu_test')) {
    throw new Error('Use an empty disposable localhost database named zelomenu_test*. Production is forbidden.');
  }
}
const client = postgres ? new pg.Client({ connectionString }) : null;
if (client) await client.connect();
const db = client ? { query: (...args) => client.query(...args), exec: (sql) => client.query(sql), close: () => client.end() } : new PGlite();
const fixture = (name) => readFile(new URL(`../supabase/tests/fixtures/${name}`, import.meta.url), 'utf8');
const owner = '10000000-0000-4000-8000-000000000001';
const empresa = '20000000-0000-4000-8000-000000000002';
const coupon = '30000000-0000-4000-8000-000000000003';
const sessionId = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n) => `checkout-key-${String(n).padStart(16, '0')}`;
const snapshots = (discount = 2, productId = 1) => ({
  cart: { items: [{ productId, productName: 'Produto', quantity: 1, unitPrice: 10, lineTotal: 10 }] },
  pricing: { subtotal: 10, deliveryFee: 0, discount, total: 10 - discount, couponCode: 'TESTE' },
  fulfillment: { type: 'pickup' }, payment: { declaredMethod: 'dinheiro' },
});
async function addSession(n, phone = '11999999999') {
  await db.query(`insert into zelomenu_cart_sessions(id,empresa_id,context,current_token_hash,customer_snapshot,pricing_snapshot)
    values ($1,$2,'public_order','token-hash',$3,$4)`, [sessionId(n), empresa, { name: 'Fixture', phone }, snapshots().pricing]);
  await db.query('insert into zelomenu_cart_tokens(session_id,token_hash) values ($1,$2)', [sessionId(n), 'token-hash']);
}
async function confirm(n, options = {}) {
  return (await db.query('select public.confirm_public_zelo_order_atomic($1,$2,$3,$4,$5) as result',
    [sessionId(n), options.token ?? 'token-hash', options.revision ?? 1, options.key ?? key(n), options.snapshots ?? snapshots()])).rows[0].result;
}
async function expectError(fn, message) { await assert.rejects(fn, new RegExp(message)); }
try {
  const manifests = JSON.parse(await fixture('canonical-migrations.json'));
  for (const manifest of manifests) {
    const body = (await fixture(manifest.fixture)).split('\n').slice(2).join('\n').replaceAll('\r\n', '\n');
    assert.equal(createHash('sha256').update(body).digest('hex'), manifest.sha256, 'SQL fixture drifted from its canonical migration');
    try {
      const canonical = await readFile(new URL(`../../zelopdv/${manifest.path}`, import.meta.url), 'utf8');
      assert.equal(createHash('sha256').update(canonical.replaceAll('\r\n', '\n')).digest('hex'), manifest.sha256, 'PDV migration changed: resync and review the fixture');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (postgres) assert.equal((await db.query("select count(*)::int as n from pg_tables where schemaname='public'")).rows[0].n, 0, 'Disposable database must be empty');
  await db.exec(await fixture('public_coupon_schema.sql'));
  await db.exec(await fixture('create_zelo_order_20260904.sql'));
  await db.exec(await fixture('public_order_coupon_atomic.sql'));
  await db.exec(await fixture('push_subscription_dispatch_lease.sql'));
  await db.exec(await fixture('delivery_quote_request_current_cart_guard.sql'));
  await db.query('insert into empresa_perfil values ($1,$2)', [empresa, owner]);
  await db.query('insert into produtos values (1,$1)', [owner]);
  await db.query("insert into zelomenu_coupons(id,id_usuario,code,discount_type,discount_value) values ($1,$2,'TESTE','valor',2)", [coupon, owner]);
  await addSession(1);
  await db.exec('set role anon');
  await expectError(() => confirm(1), 'permission denied');
  await db.exec('set role authenticated');
  await expectError(() => confirm(1), 'permission denied');
  await db.exec('set role service_role');
  await expectError(() => confirm(1, { token: 'invalid-token' }), 'STALE_CART_TOKEN');
  await expectError(() => confirm(1, { revision: 2 }), 'REVISION_CONFLICT');
  await expectError(() => confirm(1, { snapshots: snapshots(1) }), 'COUPON_CHANGED');
  const first = await confirm(1);
  assert.equal(first.alreadyConfirmed, false);
  await db.exec('reset role');
  const redemptions = (await db.query('select order_id from zelomenu_coupon_redemptions')).rows;
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].order_id, first.orderId);
  await db.query('update zelomenu_cart_sessions set revision=2 where id=$1', [sessionId(1)]);
  await db.exec('set role service_role');
  const replay = await confirm(1);
  assert.equal(replay.orderId, first.orderId);
  assert.equal(replay.alreadyConfirmed, true);
  await db.exec('reset role');
  await addSession(2);
  await addSession(3, '11988888888');
  await db.exec('set role service_role');
  await expectError(() => confirm(2), 'COUPON_ALREADY_USED');
  await expectError(() => confirm(3, { snapshots: snapshots(2, 99) }), 'PRODUCT_NOT_FOUND');
  await db.exec('reset role');
  for (const [patch, expected] of [
    ["active=false", 'COUPON_INVALID'],
    ["min_order_value=20", 'COUPON_MIN_NOT_MET'],
    ["starts_at=now()+interval '1 day'", 'COUPON_EXPIRED'],
    ["expires_at=now()-interval '1 day'", 'COUPON_EXPIRED'],
  ]) {
    await db.exec(`update zelomenu_coupons set ${patch}`);
    await db.exec('set role service_role');
    await expectError(() => confirm(3), expected);
    await db.exec('reset role');
    await db.exec('update zelomenu_coupons set active=true,min_order_value=null,starts_at=null,expires_at=null');
  }
  assert.equal((await db.query('select count(*)::int as n from zelo_orders')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from zelomenu_coupon_redemptions')).rows[0].n, 1);
  assert.equal((await db.query('select cart_snapshot from zelomenu_cart_sessions where id=$1', [sessionId(3)])).rows[0].cart_snapshot, null);
  await db.exec('set role service_role');
  await expectError(() => confirm(3, { key: key(1) }), 'IDEMPOTENCY_KEY_CONFLICT');
  await confirm(3);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from zelo_orders')).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from zelomenu_coupon_redemptions')).rows[0].n, 2);
  console.log('Public coupon atomicity: ACL, token, revision, discount, success, replay, duplicate phone, rollback and key binding passed.');
  const pushId = '60000000-0000-4000-8000-000000000006';
  const order = (await db.query('select id,status,revision from zelo_orders where id=$1', [first.orderId])).rows[0];
  await db.query('insert into zelomenu_push_subscriptions(id,order_id) values ($1,$2)', [pushId, order.id]);
  const claimSql = 'select claim_zelomenu_order_push($1,$2,$3,$4) as lease';
  const claimArgs = [pushId, order.id, order.revision, order.status];
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await expectError(() => db.query(claimSql, claimArgs), 'permission denied');
  }
  await db.exec('set role service_role');
  const lease = (await db.query(claimSql, claimArgs)).rows[0].lease;
  assert(lease);
  assert.equal((await db.query(claimSql, claimArgs)).rows[0].lease, null);
  await db.exec('reset role');
  await db.query("update zelomenu_push_subscriptions set dispatch_lease_until=now()-interval '1 second' where id=$1", [pushId]);
  await db.exec('set role service_role');
  const renewed = (await db.query(claimSql, claimArgs)).rows[0].lease;
  assert(renewed); assert.notEqual(renewed, lease);
  await db.exec('reset role');
  assert.equal((await db.query('update zelomenu_push_subscriptions set last_order_revision=$1 where id=$2 and dispatch_lease_id=$3 returning id', [order.revision, pushId, lease])).rows.length, 0);
  await db.query('update zelomenu_push_subscriptions set dispatch_lease_id=null,dispatch_lease_until=null where id=$1', [pushId]);
  console.log('Push lease: ACL, exclusive claim, expiry recovery and stale checkpoint fence passed.');
  for (const [n, pointer] of [[10, '70000000-0000-4000-8000-000000000010'], [11, 'another-request'], [12, null]]) {
    const requestId = `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    await addSession(n);
    await db.query('update zelomenu_cart_sessions set fulfillment_snapshot=$1 where id=$2', [{ type: 'delivery', deliveryQuoteRequestId: pointer, deliveryAddress: 'Rua fixture' }, sessionId(n)]);
    await db.query('insert into zelomenu_delivery_quote_requests(id,company_id,session_id) values ($1,$2,$3)', [requestId, empresa, sessionId(n)]);
    const before = (await db.query('select to_jsonb(s) as row from zelomenu_cart_sessions s where id=$1', [sessionId(n)])).rows[0].row;
    await db.exec('set role service_role');
    const resolve = () => db.query('select * from resolve_zelomenu_delivery_quote_request($1,$2,$3,$4)', [empresa, requestId, 7, { manual: true }]);
    if (n === 10) assert.equal(Number((await resolve()).rows[0].next_revision), 2);
    else await expectError(resolve, 'QUOTE_REQUEST_STALE');
    await db.exec('reset role');
    if (n !== 10) {
      assert.deepEqual((await db.query('select to_jsonb(s) as row from zelomenu_cart_sessions s where id=$1', [sessionId(n)])).rows[0].row, before);
      assert.equal((await db.query('select status from zelomenu_delivery_quote_requests where id=$1', [requestId])).rows[0].status, 'pending');
    }
  }
  console.log('Manual quote: matching current request accepted; mismatched/null pointers rejected without any cart/request mutation.');
  if (postgres) {
    await addSession(4, '11777777777');
    await addSession(5, '11777777777');
    const firstClient = new pg.Client({ connectionString });
    const secondClient = new pg.Client({ connectionString });
    await firstClient.connect(); await secondClient.connect();
    try {
      await firstClient.query('set role service_role');
      await secondClient.query('set role service_role');
      const secondPid = (await secondClient.query('select pg_backend_pid() as pid')).rows[0].pid;
      await firstClient.query('begin');
      const sql = 'select confirm_public_zelo_order_atomic($1,$2,$3,$4,$5)';
      await firstClient.query(sql, [sessionId(4), 'token-hash', 1, key(4), snapshots()]);
      const competing = secondClient.query(sql, [sessionId(5), 'token-hash', 1, key(5), snapshots()]).then(() => null, (error) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        waiting = (await db.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1", [secondPid])).rows[0]?.waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(waiting, true, 'Second independent backend must wait on the coupon row lock');
      await firstClient.query('commit');
      const error = await competing;
      assert.match(error?.message ?? '', /COUPON_ALREADY_USED/);
      assert.equal((await db.query('select count(*)::int as n from zelo_orders')).rows[0].n, 3);
      assert.equal((await db.query('select count(*)::int as n from zelomenu_coupon_redemptions')).rows[0].n, 3);
      console.log('Native PostgreSQL: two independent backends competed, lock wait observed, exactly one order/redemption committed.');
      await firstClient.query('begin');
      assert((await firstClient.query(claimSql, claimArgs)).rows[0].lease);
      const competingClaim = secondClient.query(claimSql, claimArgs);
      waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        waiting = (await db.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1", [secondPid])).rows[0]?.waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(waiting, true, 'Second independent push dispatcher must wait on the row lock');
      await firstClient.query('commit');
      assert.equal((await competingClaim).rows[0].lease, null);
      console.log('Native PostgreSQL: competing push dispatchers observed row lock and exactly one lease.');
    } finally { await firstClient.query('rollback'); await firstClient.end(); await secondClient.end(); }
  } else console.log('Multi-backend lock test requires npm run test:sql:postgres; PGlite executes a single backend.');
} finally { await db.close(); }
