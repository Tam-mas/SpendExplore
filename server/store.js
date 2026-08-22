import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');

// Allow-list of collection names. This is also the defence against a path
// traversal via a crafted API request, so it must stay exhaustive.
const COLLECTIONS = {
  ledger:     { file: 'ledger.json',     seed: () => [] },
  categories: { file: 'categories.json', seedFile: 'categories.json' },
  rules:      { file: 'rules.json',      seedFile: 'rules.json' },
  accounts:   { file: 'accounts.json',   seed: () => [] },
  views:      { file: 'views.json',      seed: () => [] },
  imports:    { file: 'imports.json',    seed: () => [] }
};

const exists = async (path) => {
  try { await access(path); return true; } catch { return false; }
};

export function createStore(dataDir) {
  const pathFor = (name) => {
    const spec = COLLECTIONS[name];
    if (!spec) throw new Error(`Unknown collection: ${name}`);
    return join(dataDir, spec.file);
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
      throw new Error(
        `${COLLECTIONS[name].file} is not valid JSON. ` +
        `Restore it from data/backups/ before starting again.`
      );
    }
  }

  /** Atomic: write a temp file then rename, so the target is never half-written.
   *  Serialisation happens before any I/O, so a value that fails to serialise
   *  (e.g. a circular reference) never touches disk and the existing file is untouched. */
  async function write(name, data) {
    const path = pathFor(name);
    const tmp = `${path}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
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
   * mutates anything. The timestamp is millisecond-resolution, so two backups
   * requested in the same millisecond would otherwise collide and the second
   * would silently overwrite the first; probe for an existing directory and
   * disambiguate with a numeric suffix so every call gets its own directory.
   */
  async function backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = join(dataDir, 'backups');
    let dir = join(backupsDir, stamp);
    let suffix = 1;
    while (await exists(dir)) {
      dir = join(backupsDir, `${stamp}-${suffix++}`);
    }
    await mkdir(dir, { recursive: true });
    for (const name of Object.keys(COLLECTIONS)) {
      const src = pathFor(name);
      if (await exists(src)) await copyFile(src, join(dir, COLLECTIONS[name].file));
    }
    return dir;
  }

  return { read, write, init, backup, dataDir };
}
