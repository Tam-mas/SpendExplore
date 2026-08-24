import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { UserFacingError } from './http.js';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');

// Allow-list of collection names. This is also the defence against a path
// traversal via a crafted API request, so it must stay exhaustive — and must
// be checked with Object.hasOwn, not a truthiness check, or an inherited
// property name (toString, constructor, __proto__, ...) resolves to a
// truthy member of Object.prototype and slips past the guard.
const COLLECTIONS = {
  ledger:     { file: 'ledger.json',     seed: () => [] },
  categories: { file: 'categories.json', seedFile: 'categories.json' },
  rules:      { file: 'rules.json',      seedFile: 'rules.json' },
  // `accounts` is never written by any route today — every ingested
  // transaction gets accountId: 'default' with no matching record — so the
  // filter bar's Account and Person dropdowns are permanently empty/inert.
  // Left as-is (a known gap, not a bug): building account management is a
  // separate feature, not a fix.
  accounts:   { file: 'accounts.json',   seed: () => [] },
  // `views` (saved named views) is shipped in every GET /api/snapshot but
  // has no frontend consumer yet — noted future work ("Plan 3"), not dead
  // code to remove.
  views:      { file: 'views.json',      seed: () => [] },
  imports:    { file: 'imports.json',    seed: () => [] },
  budgets:    { file: 'budgets.json',    seed: () => [] }
};

const exists = async (path) => {
  try { await access(path); return true; } catch { return false; }
};

export function createStore(dataDir) {
  const pathFor = (name) => {
    if (!Object.hasOwn(COLLECTIONS, name)) throw new Error(`Unknown collection: ${name}`);
    return join(dataDir, COLLECTIONS[name].file);
  };

  async function read(name) {
    const path = pathFor(name);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return await defaultFor(name);
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      // Safe to show the user verbatim: names only the collection file and
      // tells them where to find a backup, no filesystem internals.
      throw new UserFacingError(
        `${COLLECTIONS[name].file} is not valid JSON. ` +
        `Restore it from data/backups/ before starting again.`
      );
    }
  }

  /** Atomic: serialise, write a *uniquely named* temp file, then rename over
   *  the target. Serialisation happens before any I/O, so a value that fails
   *  to serialise (e.g. a circular reference) never touches disk and the
   *  existing file is untouched. The temp filename includes a random UUID so
   *  two concurrent writers to the same collection never share one temp file
   *  (which would let one caller's rename silently move the other caller's
   *  data into place while reporting its own write as successful). If the
   *  process dies between writeFile and rename, the stale `<file>.<uuid>.tmp`
   *  is simply orphaned — it's never renamed over the target, and harmless
   *  leftover files like it are not cleaned up automatically, but a later
   *  write for that collection creates its own fresh temp file rather than
   *  reusing it, so nothing depends on it existing. */
  async function performWrite(path, data) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  }

  // Per-collection write queue: concurrent write() calls for the SAME
  // collection must not interleave, or their independent tmp-write/rename
  // pairs can race arbitrarily (whichever rename runs last wins, regardless
  // of which caller's promise fulfils first). Chaining onto a promise keyed
  // by collection name forces same-collection writes to run one at a time,
  // in call order, so success/failure always reflects what actually landed.
  const writeChains = new Map();

  async function write(name, data) {
    const path = pathFor(name);
    const previous = writeChains.get(name) ?? Promise.resolve();
    const run = () => performWrite(path, data);
    const result = previous.then(run, run);
    // Keep the chain itself always-resolving so one failed write doesn't
    // permanently wedge every later write to the same collection; the
    // caller still observes `result`'s real outcome for their own write.
    writeChains.set(name, result.catch(() => {}));
    return result;
  }

  async function defaultFor(name) {
    const spec = COLLECTIONS[name];
    if (spec.seedFile) return JSON.parse(await readFile(join(SEED_DIR, spec.seedFile), 'utf8'));
    return spec.seed();
  }

  async function init() {
    await mkdir(dataDir, { recursive: true });
    for (const name of Object.keys(COLLECTIONS)) {
      if (!(await exists(pathFor(name)))) await write(name, await defaultFor(name));
    }
  }

  /**
   * Snapshot every data file into data/backups/<timestamp>/ before an import
   * mutates anything. The timestamp is millisecond-resolution, so two
   * concurrent (or same-millisecond) backups need real exclusivity, not just
   * a check-then-act probe — access()-then-mkdir is TOCTOU and both callers
   * can pass the check before either creates the directory. Instead, a
   * *non-recursive* mkdir is the exclusivity check itself: mkdir is atomic
   * at the filesystem level, so exactly one caller can successfully create a
   * given directory name. A caller that loses the race gets EEXIST and
   * retries with the next numeric suffix until it claims a free name.
   */
  async function backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = join(dataDir, 'backups');
    await mkdir(backupsDir, { recursive: true });

    let suffix = 0;
    for (;;) {
      const candidate = suffix === 0 ? stamp : `${stamp}-${suffix}`;
      const dir = join(backupsDir, candidate);
      try {
        await mkdir(dir);
      } catch (err) {
        if (err.code === 'EEXIST') { suffix += 1; continue; }
        throw err;
      }
      for (const name of Object.keys(COLLECTIONS)) {
        const src = pathFor(name);
        if (await exists(src)) await copyFile(src, join(dir, COLLECTIONS[name].file));
      }
      return dir;
    }
  }

  return { read, write, init, backup, dataDir };
}
