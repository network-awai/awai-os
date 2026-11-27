// Live form editing buffer bound to the shared semantic store (P1 #1, P1 #2, P2 #5):
// - Keeps a single live draft buffer for the active draftId across Saves so post-Save edits
//   from existing DOM handlers are never dropped into a stale object reference.
// - Preserves all unsaved draft fields (and unsaved edits in other evidence rows) across
//   soudan.evidence.add and soudan.evidence.remove.
// - Executes Send dry-run preview strictly against the in-memory working snapshot WITHOUT
//   calling save(), mutating storage, bumping revision, or writing an update audit entry.

import {newEvidence, restoreDraft} from './model.js';

export function createFormSession(store) {
  let draftId = null;
  let buffer = null;

  function syncFromStore() {
    const rec = store.getActiveDraft();
    draftId = rec.id;
    buffer = restoreDraft(rec.draft);
    return buffer;
  }

  function draft() {
    const rec = store.getActiveDraft();
    if (!buffer || draftId !== rec.id) return syncFromStore();
    return buffer;
  }

  async function save({actor = {kind: 'human'}} = {}) {
    const rec = store.getActiveDraft();
    const current = draft();
    const res = await store.execute('soudan.draft.update', {id: rec.id, patch: current}, {actor});
    // Only replace the live buffer on conflict reload; on normal success keep the live reference
    // intact so active DOM input listeners continue mutating the buffer seamlessly!
    if (res.conflict) syncFromStore();
    return res;
  }

  async function addEvidence({actor = {kind: 'human'}} = {}) {
    const current = draft();
    const row = newEvidence();
    const res = await store.execute('soudan.evidence.add', {row}, {actor});
    if (res.ok) {
      // Append the new row to the live buffer WITHOUT clobbering any unsaved summary/timeline/evidence edits.
      current.evidence.push(row);
    } else if (res.conflict) {
      syncFromStore();
    }
    return res;
  }

  async function removeEvidence(index, {actor = {kind: 'human'}} = {}) {
    const current = draft();
    const res = await store.execute('soudan.evidence.remove', {index}, {actor});
    if (res.ok) {
      // Remove only the target row from the live buffer WITHOUT clobbering any other unsaved edits.
      current.evidence.splice(index, 1);
    } else if (res.conflict) {
      syncFromStore();
    }
    return res;
  }

  // Pure in-memory Send dry-run preview: NEVER persists, NEVER bumps revision, NEVER writes audit.
  async function dryRunSend({mode, actor = {kind: 'human'}} = {}) {
    return store.execute('soudan.memo.send', {mode, dryRun: true, draft: draft()}, {actor});
  }

  return Object.freeze({
    draft,
    syncFromStore,
    save,
    addEvidence,
    removeEvidence,
    dryRunSend,
  });
}
