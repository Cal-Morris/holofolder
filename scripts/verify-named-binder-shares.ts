// Explicit hosted verification; schema and synthetic fixtures are always rolled back.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"

async function main() {
if (!process.argv.includes("--hosted-rollback")) throw new Error("Pass --hosted-rollback to verify the configured database without persisting changes")
const target = new URL(process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "")
target.searchParams.delete("sslmode")
const db = new pg.Client({ connectionString: target.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
const owner = crypto.randomUUID(), partner = crypto.randomUUID(), stranger = crypto.randomUUID()
const binder = crypto.randomUUID(), otherBinder = crypto.randomUUID()
const fixtureName = `fixture-${crypto.randomUUID().slice(0, 12)}`
let checks = 0
async function actor(id: string | null, role = "authenticated") {
  await db.query("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [id ?? "", JSON.stringify(id ? { sub: id, role } : { role })])
  await db.query(`set local role ${role === "anon" ? "anon" : "authenticated"}`)
}
async function denied(sql: string, values: unknown[], code: string) {
  await db.query("savepoint denied_write")
  try {
    await assert.rejects(db.query(sql, values), (error: { code?: string }) => error.code === code)
    checks++
  } finally {
    await db.query("rollback to savepoint denied_write")
    await db.query("release savepoint denied_write")
  }
}
try {
  await db.query("begin")
  const migration = await readFile(new URL("./045_named_binder_shares.sql", import.meta.url), "utf8")
  await db.query(migration)
  await db.query(migration)
  checks++
  await db.query("insert into auth.users(id, email) values ($1,$2),($3,$4),($5,$6)", [owner, `${owner}@synthetic.invalid`, partner, `${partner}@synthetic.invalid`, stranger, `${stranger}@synthetic.invalid`])
  await db.query("insert into public.binders(id,owner_user_id,name) values ($1,$2,'Synthetic public binder'),($3,$2,'Synthetic other binder')", [binder, owner, otherBinder])
  await db.query("insert into public.partnerships(user1_id,user2_id,owner_user_id) values ($1,$2,$1)", [owner, partner])
  await db.query("insert into public.binder_shares(owner_user_id,binder_id,token,is_enabled) values ($1,$2,$3,true)", [owner, binder, crypto.randomUUID()])
  await actor(owner)
  assert.equal((await db.query("select public.set_account_username($1) as name", [fixtureName.toUpperCase()])).rows[0].name, fixtureName)
  assert.equal((await db.query("select public.set_binder_public_slug($1,'National') as slug", [binder])).rows[0].slug, "national")
  checks += 2
  await denied("select * from public.resolve_named_binder_share($1,'national')", [fixtureName], "42501")
  await db.query("reset role")
  assert.equal((await db.query("select * from public.resolve_named_binder_share($1,'national')", [fixtureName])).rows[0].binder_id, binder)
  await db.query("update public.binder_shares set is_enabled=false where binder_id=$1", [binder])
  assert.equal((await db.query("select * from public.resolve_named_binder_share($1,'national')", [fixtureName])).rowCount, 0)
  await db.query("update public.binder_shares set is_enabled=true where binder_id=$1", [binder])
  checks += 2
  await actor(owner)
  await denied("select public.set_account_username('a/b')", [], "22023")
  await denied("select public.set_binder_public_slug($1,'../private')", [binder], "22023")
  await denied("insert into public.account_usernames(username,user_id) values ('bypass',$1)", [owner], "42501")
  await db.query("select public.set_account_username($1)", [`${fixtureName}-new`])
  await db.query("select public.set_binder_public_slug($1,'trades')", [binder])
  assert.equal((await db.query("select username from public.account_usernames where is_active")).rows[0].username, `${fixtureName}-new`)
  checks++
  await db.query("reset role")
  assert.equal((await db.query("select * from public.resolve_named_binder_share($1,'national')", [fixtureName])).rowCount, 0)
  assert.equal((await db.query("select * from public.resolve_named_binder_share($1,'trades')", [`${fixtureName}-new`])).rows[0].binder_id, binder)
  checks += 2
  await actor(partner)
  assert.equal((await db.query("select * from public.account_usernames")).rowCount, 0)
  checks++
  await denied("select public.set_binder_public_slug($1,'partner-edit')", [binder], "42501")
  await denied("select public.set_account_username($1)", [fixtureName.toUpperCase()], "23505")
  await db.query("select public.set_account_username($1)", [`${fixtureName}-partner`])
  checks++
  await actor(stranger)
  await denied("select public.set_binder_public_slug($1,'stranger-edit')", [binder], "42501")
  await actor(owner)
  await denied("select public.set_binder_public_slug($1,'national')", [otherBinder], "23505")
  await db.query("select public.set_account_username($1)", [fixtureName])
  await db.query("select public.set_binder_public_slug($1,'national')", [binder])
  assert.equal((await db.query("select slug from public.binder_public_slugs where is_active")).rows[0].slug, "national")
  checks++
  await actor(null, "anon")
  await denied("select public.set_account_username($1)", [fixtureName], "42501")
  await denied("select * from public.account_usernames", [], "42501")
  await db.query("reset role")
  const plan = (await db.query("explain (analyze, buffers, format json) select * from public.resolve_named_binder_share($1, 'national')", [fixtureName])).rows[0]["QUERY PLAN"][0].Plan
  assert.equal(plan["Actual Rows"], 1)
  console.log(`Resolver EXPLAIN ANALYZE: ${plan["Node Type"]}, one expected synthetic binder`)
  checks++
  await db.query("delete from public.binders where id=$1", [binder])
  assert.equal((await db.query("select binder_id from public.binder_public_slugs where owner_user_id=$1 and slug='national'", [owner])).rows[0].binder_id, null)
  await db.query("delete from auth.users where id=$1", [owner])
  assert.equal((await db.query("select user_id from public.account_usernames where username=$1", [fixtureName])).rows[0].user_id, null)
  checks += 2
  await actor(partner)
  await denied("select public.set_account_username($1)", [fixtureName], "23505")
  console.log(`PASS: ${checks} schema, normalization, reservations, ownership, RLS and deletion checks; all changes rolled back`)
} finally {
  await db.query("rollback")
  await db.end()
}

}
void main().catch(error => { console.error(error); process.exitCode = 1 })
