/**
 * One serialization queue, shared by every route module that does a
 * read-modify-write across store collections spanning multiple `await`
 * points. store.js only serializes concurrent writes to the SAME
 * collection against each other (see its `writeChains` map) — it has no
 * notion of "read collection X, decide something, write collection X" as
 * one atomic unit, so two concurrent handlers can both read the same
 * pre-mutation snapshot and then write one after another, silently
 * dropping whichever wrote first.
 *
 * server/routes/import.js originally built its own local gate for exactly
 * this reason (see its history: two concurrent commits could both return
 * 200 while one's rows vanished). server/routes/transactions.js has the
 * identical hazard — a PATCH does read-ledger / compute / write-ledger,
 * touching the SAME 'ledger' collection an import commit does — so a
 * PATCH racing a commit (or two PATCHes racing each other) can lose an
 * update exactly the same way. A gate owned by one route module can't
 * protect a different module's handlers from each other, so this is
 * pulled out to be shared: server/routes.js creates one instance and
 * hands it to both createImportRoutes() and createTransactionRoutes(),
 * so ledger-touching handlers from either module queue behind one
 * another regardless of which module they live in.
 */
export function createMutationGate() {
  let gate = Promise.resolve();
  return function serialized(fn) {
    const result = gate.then(fn, fn);
    // Keep the chain itself always-resolving so one failed handler doesn't
    // permanently wedge every later mutation waiting behind it; callers
    // still observe `result`'s real outcome for their own request.
    gate = result.then(() => {}, () => {});
    return result;
  };
}
