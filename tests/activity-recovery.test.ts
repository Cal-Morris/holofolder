import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recoveryApplySchema, recoveryPreviewSchema, recoveryExplanation } from '../lib/domain/activity-recovery'
test('recovery accepts only exact reviewed confirmed intents and string event IDs',()=>{
  assert.equal(recoveryPreviewSchema.safeParse({eventId:'9223372036854775808'}).success,false)
  assert.equal(recoveryPreviewSchema.safeParse({eventId:12}).success,false)
  assert.deepEqual(recoveryPreviewSchema.parse({eventId:'12'}),{eventId:'12',restoreUnassignedItemIds:[]})
  const request={eventId:'12',operationId:'synthetic-retry',planVersion:1,planToken:'a'.repeat(64),confirmed:true}
  assert.equal(recoveryApplySchema.safeParse(request).success,true)
  assert.equal(recoveryApplySchema.safeParse({...request,confirmed:false}).success,false)
  assert.equal(recoveryApplySchema.safeParse({...request,ownerId:'foreign'}).success,false)
  assert.equal(recoveryApplySchema.safeParse({...request,planToken:'wrong'}).success,false)
  assert.match(recoveryExplanation('card_changed'),/newer edit/)
})
