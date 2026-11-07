// Uses temporary synthetic accounts on the configured project; always removes them and their names.
import assert from "node:assert/strict"
import pg from "pg"

async function main() {
  if (!process.argv.includes("--hosted-concurrency")) throw new Error("Pass --hosted-concurrency to test the configured project's applied identity schema")
  const target = new URL(process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "")
  target.searchParams.delete("sslmode")
  const connect = async () => {
    const db = new pg.Client({ connectionString: target.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
    await db.connect()
    return db
  }
  const admin = await connect()
  const clients: pg.Client[] = []
  const owners = [crypto.randomUUID(), crypto.randomUUID()]
  const fixtureEmails = owners.map(owner => `${owner}@synthetic.invalid`)
  const binders = [crypto.randomUUID(), crypto.randomUUID()]
  const sharedName = `fixture-${crypto.randomUUID().slice(0, 12)}`
  async function claim(index: number, sql: string, values: unknown[]) {
    const db = clients[index]
    await db.query("begin")
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owners[index], role: "authenticated" })])
      await db.query("set local role authenticated")
      const result = await db.query(sql, values)
      await db.query("commit")
      return result
    } catch (error) { await db.query("rollback"); throw error }
  }
  try {
    assert.ok((await admin.query("select to_regprocedure('public.set_account_username(text)') as function")).rows[0].function, "Apply migration 045 first")
    for (const owner of owners) await admin.query("insert into auth.users(id,email) values ($1,$2)", [owner, `${owner}@synthetic.invalid`])
    for (const binder of binders) await admin.query("insert into public.binders(id,owner_user_id,name) values ($1,$2,'Synthetic concurrency binder')", [binder, owners[0]])
    for (let index = 0; index < 2; index++) clients.push(await connect())
    for (const index of [0, 1]) await claim(index, "select public.set_account_username($1)", [`${sharedName}-${index}`])
    const claims = await Promise.allSettled([0, 1].map(index => claim(index, "select public.set_account_username($1)", [index ? sharedName.toUpperCase() : sharedName])))
    assert.equal(claims.filter(result => result.status === "fulfilled").length, 1)
    const loser = claims.findIndex(result => result.status === "rejected")
    const rejected = claims[loser] as PromiseRejectedResult
    assert.equal(rejected.reason.code, "23505")
    assert.equal((await admin.query("select username from public.account_usernames where user_id=$1 and is_active", [owners[loser]])).rows[0].username, `${sharedName}-${loser}`)
    // Same owner's two binders contend for a slug, including advisory-lock serialization.
    await admin.query("begin")
    await admin.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owners[0], role: "authenticated" })])
    await admin.query("set local role authenticated")
    for (const [index, binder] of binders.entries()) await admin.query("select public.set_binder_public_slug($1,$2)", [binder, `old-${index}`])
    await admin.query("commit")
    owners[1] = owners[0] // Both claim clients now authenticate as the binder owner.
    const slugs = await Promise.allSettled(binders.map((binder, index) => claim(index, "select public.set_binder_public_slug($1,'shared-slug')", [binder])))
    assert.equal(slugs.filter(result => result.status === "fulfilled").length, 1)
    const slugLoser = slugs.findIndex(result => result.status === "rejected")
    assert.equal((slugs[slugLoser] as PromiseRejectedResult).reason.code, "23505")
    assert.equal((await admin.query("select slug from public.binder_public_slugs where binder_id=$1 and is_active", [binders[slugLoser]])).rows[0].slug, `old-${slugLoser}`)
    console.log("PASS: concurrent case-insensitive username and same-owner slug claims each have one winner; rejected claims preserve previous addresses")
  } finally {
    await admin.query("rollback")
    for (const db of clients) await db.end()
    // The test owns only these exact synthetic addresses, never real account reservations.
    await admin.query("delete from public.binder_public_slugs where binder_id=any($1::uuid[])", [binders])
    await admin.query("delete from public.binders where id=any($1::uuid[])", [binders])
    await admin.query("delete from public.account_usernames where username=any($1::text[])", [[sharedName, `${sharedName}-0`, `${sharedName}-1`]])
    await admin.query("delete from auth.users where email=any($1::text[])", [fixtureEmails])
    assert.equal((await admin.query("select 1 from auth.users where email=any($1::text[])", [fixtureEmails])).rowCount, 0)
    assert.equal((await admin.query("select 1 from public.account_usernames where username=any($1::text[])", [[sharedName, `${sharedName}-0`, `${sharedName}-1`]])).rowCount, 0)
    await admin.end()
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
