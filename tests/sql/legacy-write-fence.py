"""Explicit local, synthetic-only proof. Requires psycopg 3; see docs/legacy-write-fence.md.
Never connects using environment database credentials. No hosted mode.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

parser = argparse.ArgumentParser()
parser.add_argument('--socket', required=True)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('--user', required=True)
parser.add_argument('--database', required=True)
args = parser.parse_args()
assert args.socket.startswith('/') and args.database.endswith('_synthetic')
config = dict(host=args.socket, port=args.port, user=args.user, dbname=args.database)
def connect():
    return psycopg.connect(**config, autocommit=True)
db = connect()
assert db.execute('SELECT count(*) FROM auth.users').fetchone()[0] == 0, 'requires empty synthetic schema restore'
repo = Path(__file__).resolve().parents[2]
migration = (repo / 'scripts/096_legacy_write_fence.sql').read_text()
checks = []
def passed(name):
    checks.append(name)
    print('ok:', name, flush=True)
def reject(call, states=('PT503',)):
    try:
        call()
    except psycopg.Error as error:
        assert error.sqlstate in states, (error.sqlstate, str(error))
        if error.sqlstate == 'PT503':
            assert 'retainOnDevice=true' in error.diag.message_detail
        return
    raise AssertionError('unexpected acceptance')
def rollback_test(call, states=('PT503',)):
    with connect() as c:
        c.execute('BEGIN')
        reject(lambda: call(c), states)
        c.execute('ROLLBACK')
def blocked(pid):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if db.execute('SELECT cardinality(pg_blocking_pids(%s))>0', (pid,)).fetchone()[0]:
            return
        time.sleep(.01)
    raise AssertionError('expected a real lock wait')
def context(c, source='app', generation=None, purpose=None, actor=None, role='service_role'):
    value = dict(actor=dict(kind='user', userId=actor or owner), source=source,
                 operationId=str(uuid.uuid4()), clientId='synthetic-key' if source in ('rest', 'mcp') else None)
    if generation is not None:
        value['legacyQueueGeneration'] = generation
    if purpose is not None:
        value['purpose'] = purpose
    c.execute("SELECT set_config('request.headers',%s,true)", (json.dumps({'x-holo-audit-context': json.dumps(value)}),))
    c.execute('SET LOCAL ROLE ' + role)
    return value
owner = '09600000-0000-4000-8000-000000000001'
partner = '09600000-0000-4000-8000-000000000002'
stranger = '09600000-0000-4000-8000-000000000003'
binder = '09600000-0000-4000-8000-000000000011'
extra = '09600000-0000-4000-8000-000000000012'
converted = '09600000-0000-4000-8000-000000000013'
def row(pokemon=1):
    return dict(pokemon_name='Synthetic fence card', status='collected', card_id=None,
                card_name=None, card_image=None, card_set=None, card_language='en', card_finish='normal', wanted_cards=[])
def save(c, pokemon=2, expected=None, actor=None):
    return c.execute('SELECT public.save_collection_with_acquisition(%s,%s,%s,%s,%s,%s,NULL,NULL)',
                     (owner,binder,actor or owner,pokemon,Jsonb(row(pokemon)),Jsonb(expected) if expected is not None else None)).fetchone()[0]
def delete(c, pokemon=1, expected=None):
    return c.execute('SELECT public.developer_delete_collection(%s,%s,%s,%s,%s)',
                     (owner,owner,binder,pokemon,Jsonb(expected) if expected is not None else None)).fetchone()[0]
def current(c, pokemon=1):
    return c.execute('SELECT to_jsonb(p) FROM public.pokemon_collection p WHERE binder_id=%s AND pokemon_id=%s', (binder,pokemon)).fetchone()[0]
def direct(c, kind='UPDATE'):
    if kind=='INSERT':
        c.execute("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES(%s,%s,99,'Synthetic rejected','collected')", (owner,binder))
    elif kind=='UPDATE':
        c.execute("UPDATE public.pokemon_collection SET card_name='Synthetic changed' WHERE binder_id=%s AND pokemon_id=1", (binder,))
    else:
        c.execute('DELETE FROM public.pokemon_collection WHERE binder_id=%s AND pokemon_id=1', (binder,))
def fingerprint():
    return db.execute("SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.pokemon_collection p), (SELECT count(*) FROM public.collection_activity), (SELECT count(*) FROM public.partner_acquisitions), (SELECT count(*) FROM public.developer_idempotency)").fetchone()
def active():
    return db.execute('SELECT enforced FROM collection_audit_private.legacy_write_fence').fetchone()[0]

try:
    db.execute(migration); db.execute(migration)
    assert not active()
    db.execute('BEGIN')
    db.execute('INSERT INTO auth.users(id) VALUES(%s),(%s),(%s)', (owner,partner,stranger))
    db.execute('INSERT INTO public.billing_configuration(id,enforced) VALUES(true,false)')
    db.execute("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES(%s,'manual')", (owner,))
    db.execute('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES(%s,%s,%s)', (owner,partner,owner))
    db.execute("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES(%s,%s,'Synthetic default',true),(%s,%s,'Synthetic disposable',false)", (binder,owner,extra,owner))
    db.execute("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES(%s,%s,1,'Synthetic fence card','collected'),(%s,%s,1,'Synthetic lifecycle card','collected')", (owner,binder,owner,extra))
    db.execute('COMMIT')
    db.execute('BEGIN')
    db.execute("INSERT INTO public.binders(id,owner_user_id,name) VALUES(%s,%s,'Synthetic converted')",(converted,owner))
    db.execute("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES(%s,%s,1,'Synthetic converted source','collected')",(owner,converted))
    db.execute('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
    db.execute("SELECT public.convert_legacy_binder_v1(%s,%s,public.legacy_binder_evidence_v1(%s)->>'rowsDigest')",(converted,owner,converted))
    db.execute('COMMIT')
    passed('inactive install twice, synthetic fixtures')
    for role in ('anon','authenticated','holo_mcp','service_role'):
        assert not db.execute("SELECT has_schema_privilege(%s,'collection_audit_private','USAGE')",(role,)).fetchone()[0]
        assert not db.execute("SELECT has_table_privilege(%s,'collection_audit_private.legacy_write_fence','UPDATE')",(role,)).fetchone()[0]
        assert db.execute("SELECT count(*) FROM pg_proc WHERE pronamespace='collection_audit_private'::regnamespace AND has_function_privilege(%s,oid,'EXECUTE')",(role,)).fetchone()[0] == 0
        rollback_test(lambda c: (c.execute('SET LOCAL ROLE '+role),c.execute('SELECT collection_audit_private.activate_legacy_write_fence()')), ('42501',))
        rollback_test(lambda c: (c.execute('SET LOCAL ROLE '+role),c.execute('UPDATE collection_audit_private.legacy_write_fence SET enforced=true')), ('42501',))
        rollback_test(lambda c: (c.execute('SET LOCAL ROLE '+role),c.execute("INSERT INTO collection_audit_private.pending(transaction_id,owner_id,context) VALUES(txid_current(),%s,'{}')",(owner,))), ('42501',))
    rollback_test(lambda c:(c.execute('SET SESSION AUTHORIZATION authenticated'),c.execute('SET LOCAL ROLE service_role')),('42501',))
    passed('all private helpers/state inaccessible to runtime roles; native denials preserved')
    for role in ('service_role','authenticated'):
        with connect() as c:
            c.execute('BEGIN')
            c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':owner,'role':'authenticated'}),))
            c.execute('SET LOCAL ROLE '+role)
            direct(c)
            c.execute('ROLLBACK')
    passed('inactive old service fallback and authenticated RLS writes accepted')
    # Install-time table lock must wait for pre-trigger DML, not merely new trigger participants.
    db.execute('DROP TRIGGER legacy_write_fence_statement ON public.pokemon_collection; DROP TRIGGER pokemon_collection_guard_ingress ON public.pokemon_collection')
    with connect() as writer, connect() as installer, concurrent.futures.ThreadPoolExecutor() as pool:
        writer.execute('BEGIN'); direct(writer)
        pid=installer.execute('SELECT pg_backend_pid()').fetchone()[0]
        future=pool.submit(installer.execute,migration)
        blocked(pid); writer.execute('COMMIT'); future.result()
    passed('trigger installation waits for pre-trigger writer commit')
    with connect() as writer:
        writer.execute('BEGIN'); direct(writer)
        rollback_test(lambda c: c.execute(migration),('55P03',))
        writer.execute('ROLLBACK')
    assert not active()
    passed('installation lock timeout aborts safely')
    with connect() as writer:
        writer.execute('BEGIN'); direct(writer)
        rollback_test(lambda c:c.execute('SELECT collection_audit_private.activate_legacy_write_fence()'),('55P03',))
        writer.execute('ROLLBACK')
    assert not active()
    passed('activation timeout leaves fence inactive and writer intact')
    with connect() as activator:
        activator.execute('BEGIN; SELECT collection_audit_private.activate_legacy_write_fence()')
        rollback_test(lambda c:direct(c))
        activator.execute('ROLLBACK')
    assert not active()
    passed('writer lock timeout fails retention-safe while activation holds row')
    # Establish both HTTP-admitted simulations and an actual old RR snapshot before activation.
    rc=connect(); rr=connect()
    rc.execute('BEGIN ISOLATION LEVEL READ COMMITTED'); context(rc)
    rr.execute('BEGIN ISOLATION LEVEL REPEATABLE READ'); context(rr)
    assert rr.execute('SELECT count(*) FROM public.pokemon_collection').fetchone()[0] >= 2
    with connect() as writer, connect() as activator, concurrent.futures.ThreadPoolExecutor() as pool:
        writer.execute('BEGIN'); direct(writer)
        pid=activator.execute('SELECT pg_backend_pid()').fetchone()[0]
        future=pool.submit(activator.execute,'SELECT collection_audit_private.activate_legacy_write_fence()')
        blocked(pid); assert not active()
        writer.execute('COMMIT'); future.result()
    assert active()
    reject(lambda:direct(rc)); rc.execute('ROLLBACK'); rc.close()
    reject(lambda:direct(rr)); rr.execute('ROLLBACK'); rr.close()
    passed('already-writing transaction commits before activation; old RC/RR snapshots reject afterward')
    baseline=fingerprint()
    for role in ('service_role','authenticated'):
        for kind in ('INSERT','UPDATE','DELETE'):
            def denied(c):
                context(c,source='rest',role=role) if role=='authenticated' else context(c)
                c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':owner,'role':'service_role'}),))
                c.execute("SELECT set_config('holo.legacy_queue_generation','2',true)")
                direct(c,kind)
            rollback_test(denied)
    for source in ('app','unknown','system','migration'):
        rollback_test(lambda c:(context(c,source=source),direct(c)))
    for generation,purpose in ((2,None),(1,'legacy.queue'),('2','legacy.queue'),(2,'recovery.apply')):
        rollback_test(lambda c:(context(c,generation=generation,purpose=purpose),direct(c)))
    rollback_test(lambda c:direct(c))
    rollback_test(lambda c:(context(c,source='rest',role='holo_mcp'),direct(c)),('42501',))
    rollback_test(lambda c:(context(c),save(c)))
    rollback_test(lambda c:(context(c),delete(c,expected=current(db))))
    def rejected_acquisition(c):
        context(c)
        membership=db.execute('SELECT id FROM public.partnerships WHERE owner_user_id=%s',(owner,)).fetchone()[0]
        payload=row(3); payload['card_id']='synthetic-print'
        acquisition=dict(operationId=str(uuid.uuid4()),actorId=owner,partnershipId=str(membership),recipientId=partner,printingKey='synthetic-print:en:normal')
        c.execute('SELECT public.save_collection_with_acquisition(%s,%s,%s,3,%s,NULL,%s,%s)',(owner,binder,owner,Jsonb(payload),Jsonb(acquisition),'Synthetic actor'))
    rollback_test(rejected_acquisition)
    assert fingerprint()==baseline
    passed('direct/fallback/kernel INSERT UPDATE DELETE rejected atomically; spoofed headers/roles/GUCs rejected')
    for source in ('rest','mcp'):
        with connect() as c:
            c.execute('BEGIN'); context(c,source=source)
            saved=save(c)['item']
            assert save(c,expected=None).get('conflict')
            assert delete(c,pokemon=2,expected=saved)['deleted']
            c.execute('COMMIT')
    with connect() as c:
        c.execute('BEGIN'); context(c,generation=2,purpose='legacy.queue')
        save(c); c.execute('COMMIT')
    with connect() as c:
        c.execute('BEGIN'); context(c,source='rest',actor=partner)
        save(c,pokemon=3,actor=partner); c.execute('ROLLBACK')
    rollback_test(lambda c:(context(c,generation=2,purpose='legacy.queue'),c.execute("UPDATE public.pokemon_collection SET card_name='Synthetic forbidden' WHERE binder_id=%s",(converted,))),('55000',))
    passed('trusted REST/MCP CAS save/delete and future app generation/purpose supported; converted guard preserved')
    rollback_test(lambda c:(context(c,source='rest',actor=stranger),save(c,actor=stranger)),('P0001','42501'))
    passed('stranger membership denied by existing kernel/context')
    # Active billing must still reject over-cap authorized app DML.
    with connect() as c:
        c.execute('BEGIN')
        c.execute('DELETE FROM public.perpetual_licences WHERE owner_user_id=%s',(owner,))
        c.execute('UPDATE public.billing_configuration SET enforced=true,free_card_limit=1')
        context(c,generation=2,purpose='legacy.queue')
        reject(lambda:save(c,pokemon=3),('P0001',))
        c.execute('ROLLBACK')
    passed('billing enforcement remains authoritative')
    # Recovery creates exact private inverse authority only after current preview/token checks.
    with connect() as c:
        c.execute('BEGIN'); context(c,generation=2,purpose='legacy.queue')
        direct(c,'DELETE'); c.execute('COMMIT')
    event=db.execute('SELECT id::text FROM public.collection_activity WHERE owner_user_id=%s ORDER BY id DESC LIMIT 1',(owner,)).fetchone()[0]
    with connect() as c:
        c.execute('BEGIN'); ctx=context(c)
        preview=c.execute("SELECT public.collection_recovery_v1('preview',%s,%s)",(owner,Jsonb(dict(eventId=event,restoreUnassignedItemIds=[])))).fetchone()[0]
        assert preview['supported'] and not preview['conflicts'], {k:preview[k] for k in ('supported','conflicts','unsupported')}
        request=dict(eventId=event,restoreUnassignedItemIds=[],planVersion=1,planToken=preview['planToken'],operationId=ctx['operationId'],confirmed=True)
        result=c.execute("SELECT public.collection_recovery_v1('apply',%s,%s)",(owner,Jsonb(request))).fetchone()[0]
        assert c.execute("SELECT public.collection_recovery_v1('apply',%s,%s)",(owner,Jsonb(request))).fetchone()[0]==result
        c.execute('COMMIT')
    assert current(db)['pokemon_id']==1
    passed('explicit Activity recovery restores exact inverse and replays once without queue purpose')
    # A recovery-shaped header alone never creates inverse authority.
    rollback_test(lambda c:(context(c,purpose='recovery.apply'),direct(c)))
    with connect() as c:
        c.execute('BEGIN'); context(c)
        assert c.execute('SELECT public.developer_delete_binder(%s,%s,%s,true)',(owner,owner,extra)).fetchone()[0]
        c.execute('COMMIT')
    assert db.execute('SELECT count(*) FROM public.pokemon_collection WHERE binder_id=%s',(extra,)).fetchone()[0]==0
    passed('authorized binder lifecycle cascade succeeds with old app context')
    # Exercise the installed native inverse's exact frozen-source INSERT authority.
    with connect() as c:
        c.execute('BEGIN')
        revision=c.execute('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=%s',(owner,)).fetchone()[0]
        collections=c.execute('SELECT collection_id,version,layout_revision FROM public.storage_collection_state WHERE owner_user_id=%s',(owner,)).fetchall()
        slots=c.execute('SELECT s.id,s.version,p.inventory_item_id,i.version,p.version FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.collection_id=%s ORDER BY s.position',(converted,)).fetchall()
        request=dict(operationId=str(uuid.uuid4()),inventoryRevision=revision,
                     collections=[dict(collectionId=str(id),version=v,layoutRevision=l) for id,v,l in collections],
                     commands=[dict(kind='deleteCollection',collectionId=converted,replacementDefaultCollectionId=None,
                                    slots=[dict(id=id,version=v,inventoryItemId=i,itemVersion=iv,placementVersion=pv) for id,v,i,iv,pv in slots])])
        c.execute('SELECT public.inventory_command_v1(%s,%s,%s,%s)',(owner,owner,Jsonb(request),Jsonb(dict(source='app',clientId=None,batchId=None,clientOccurredAt=None))))
        c.execute('COMMIT')
    event=db.execute('SELECT id::text FROM public.collection_activity WHERE owner_user_id=%s ORDER BY id DESC LIMIT 1',(owner,)).fetchone()[0]
    with connect() as c:
        c.execute('BEGIN')
        preview=c.execute('SELECT collection_audit_private.recovery_preview_v1(%s,%s,%s,ARRAY[]::text[])',(owner,owner,event)).fetchone()[0]
        assert preview['supported'] and not preview['conflicts'], {k:preview[k] for k in ('supported','conflicts','unsupported')}
        request=dict(eventId=event,planVersion=1,planToken=preview['planToken'],operationId=str(uuid.uuid4()),restoreUnassignedItemIds=[],confirmed=True)
        c.execute('SELECT collection_audit_private.recovery_apply_v1(%s,%s,%s,%s)',(owner,owner,Jsonb(request),Jsonb(dict(source='app',clientId=None,batchId=None,clientOccurredAt=None))))
        c.execute('COMMIT')
    assert db.execute('SELECT count(*) FROM public.pokemon_collection WHERE binder_id=%s',(converted,)).fetchone()[0]==1
    passed('native converted cascade recovery uses exact existing frozen-source INSERT authority')
    with connect() as c:
        c.execute('BEGIN')
        c.execute('DELETE FROM auth.users WHERE id=%s',(owner,))
        c.execute('COMMIT')
    assert db.execute('SELECT count(*) FROM public.pokemon_collection').fetchone()[0]==0
    passed('account lifecycle cascade succeeds without generic service/trigger-depth bypass')
    rollback_test(lambda c:c.execute('UPDATE collection_audit_private.legacy_write_fence SET enforced=false'),('HF961',))
    rollback_test(lambda c:c.execute('DELETE FROM collection_audit_private.legacy_write_fence'),('HF961',))
    rollback_test(lambda c:c.execute('TRUNCATE collection_audit_private.legacy_write_fence'),('HF961',))
    db.execute(migration); assert active()
    passed('rollback/downgrade cannot reopen fence; migration reapplication stays active')
    # Corrupt/missing state simulation only in a rolled-back synthetic admin transaction.
    with connect() as c:
        c.execute('BEGIN; ALTER TABLE collection_audit_private.legacy_write_fence DISABLE TRIGGER legacy_write_fence_monotonic; DELETE FROM collection_audit_private.legacy_write_fence')
        c.execute('SAVEPOINT missing')
        reject(lambda:c.execute('DELETE FROM public.pokemon_collection'))
        c.execute('ROLLBACK TO SAVEPOINT missing')
        # Run the transactional body in this disposable corruption transaction, then roll it all back.
        body=migration.replace('BEGIN;\nSET LOCAL', 'SET LOCAL',1).rsplit('COMMIT;',1)[0]
        c.execute(body)
        assert c.execute('SELECT count(*) FROM collection_audit_private.legacy_write_fence').fetchone()[0]==0
        c.execute('SAVEPOINT still_missing')
        reject(lambda:c.execute('DELETE FROM public.pokemon_collection'))
        c.execute('ROLLBACK TO SAVEPOINT still_missing')
        c.execute('ROLLBACK')
    with connect() as c:
        c.execute('BEGIN; ALTER TABLE collection_audit_private.legacy_write_fence RENAME TO synthetic_missing_fence')
        c.execute('SAVEPOINT missing_table')
        reject(lambda:c.execute('DELETE FROM public.pokemon_collection'))
        c.execute('ROLLBACK TO SAVEPOINT missing_table')
        reject(lambda:c.execute(body),('HF961',))
        c.execute('ROLLBACK')
    passed('missing row/table fails closed; reapplication cannot recreate inactive state')
    with connect() as c:
        c.execute('BEGIN; ALTER TABLE collection_audit_private.legacy_write_fence DISABLE TRIGGER legacy_write_fence_monotonic; ALTER TABLE collection_audit_private.legacy_write_fence ALTER COLUMN enforced DROP NOT NULL; UPDATE collection_audit_private.legacy_write_fence SET enforced=NULL')
        reject(lambda:c.execute('DELETE FROM public.pokemon_collection'))
        c.execute('ROLLBACK')
    passed('corrupt null state fails retention-safe')
    assert db.execute('SELECT count(*) FROM collection_audit_private.pending').fetchone()[0]==0
    assert db.execute('SELECT count(*) FROM collection_audit_private.deltas').fetchone()[0]==0
    print(json.dumps(dict(passed=len(checks),checks=checks,synthetic_only=True)))
finally:
    db.close()
