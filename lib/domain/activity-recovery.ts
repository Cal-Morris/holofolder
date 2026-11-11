export function recoveryExplanation(reason: string) {
  if (/card_changed|version|row_changed|dependencies_changed/.test(reason))
    return 'This card changed afterwards. Undo would overwrite a newer edit.';
  if (/collection_removed|missing_collection/.test(reason)) return 'The original collection no longer exists.';
  if (/occupied/.test(reason)) return 'Another card is now in that position.';
  if (/person_no_longer|member|access/.test(reason)) return 'Someone involved no longer has access to this collection.';
  if (/missing.*history|missing_versioned_inverse/.test(reason))
    return 'This older entry does not contain enough information to undo safely.';
  if (/converted|authority/.test(reason)) return 'The collection format changed after this entry.';
  if (/private_assets/.test(reason)) return 'The original label artwork cannot be verified.';
  if (/storage_recovery_not_enabled|unsupported_change/.test(reason))
    return 'Undo is currently available for card and want list edits. This type of change cannot be undone yet.';
  return 'This change cannot be undone safely. Your collection has not been changed.';
}
