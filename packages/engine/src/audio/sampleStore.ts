import * as Tone from 'tone';

/** Metadata for a user-loaded sample (no audio — the buffer lives in the cache / IDB). */
export interface SampleMeta {
  id: string;
  name: string;
  /** MIDI note the recording sounds at, so the Sampler pitches it across the keyboard. */
  rootMidi: number;
}

/** A loaded sample: metadata plus its decoded, playable buffer. */
export interface SampleEntry extends SampleMeta {
  buffer: Tone.ToneAudioBuffer;
}

interface SampleRecord extends SampleMeta {
  bytes: ArrayBuffer;
}

const DB_NAME = 'borland-samples';
const STORE = 'samples';

/** Hard ceiling on a single sample's encoded size. Decoding is synchronous-ish and
 *  the decoded PCM is ~10× the file for compressed formats — an unbounded file can
 *  freeze the tab and blow the IndexedDB quota. 32 MB ≈ 3 min of stereo WAV. */
const MAX_SAMPLE_BYTES = 32 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/** Decode encoded file bytes into a playable Tone buffer (via a transient object URL). */
async function bufferFromBytes(bytes: ArrayBuffer): Promise<Tone.ToneAudioBuffer> {
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    return await Tone.ToneAudioBuffer.fromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 's-' + Math.abs(Date.now() ^ Math.floor(Math.random() * 1e9)).toString(36);
}

/**
 * Runtime store of user-loaded samples — the "persist + reference" model: decoded buffers
 * are cached in memory; the encoded file bytes persist in IndexedDB so samples survive a
 * reload. The Patch references a sample by id only (a node's `sampleId`); the binary never
 * enters the JSON. Mirrors the PatchStore seam — a backend store could replace IndexedDB
 * unchanged. Lives in `audio/` (not the framework-agnostic core); depends only on Tone.
 */
class SampleStore {
  private readonly buffers = new Map<string, Tone.ToneAudioBuffer>();
  private readonly metas = new Map<string, SampleMeta>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    return (this.dbPromise ??= openDb());
  }

  /** Load sample metadata from IndexedDB into memory (buffers decode lazily on use). */
  async hydrate(): Promise<void> {
    try {
      const db = await this.db();
      const all = await reqDone<SampleRecord[]>(
        db.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
      );
      for (const r of all) this.metas.set(r.id, { id: r.id, name: r.name, rootMidi: r.rootMidi });
    } catch (err) {
      console.warn('[borland] sample store hydrate failed (continuing in-memory).', err);
    }
  }

  /** All known samples (metadata) — for the studio's picker. */
  list(): SampleMeta[] {
    return [...this.metas.values()];
  }

  /** A sample with its buffer if already decoded in memory; otherwise use load(). */
  getCached(id: string): SampleEntry | undefined {
    const buffer = this.buffers.get(id);
    const meta = this.metas.get(id);
    return buffer && meta ? { ...meta, buffer } : undefined;
  }

  /** Decode (from cache or IndexedDB) and return a playable sample. */
  async load(id: string): Promise<SampleEntry | undefined> {
    const cached = this.getCached(id);
    if (cached) return cached;
    try {
      const db = await this.db();
      const rec = await reqDone<SampleRecord | undefined>(
        db.transaction(STORE, 'readonly').objectStore(STORE).get(id),
      );
      if (!rec) return undefined;
      const buffer = await bufferFromBytes(rec.bytes);
      const meta: SampleMeta = { id: rec.id, name: rec.name, rootMidi: rec.rootMidi };
      this.buffers.set(id, buffer);
      this.metas.set(id, meta);
      return { ...meta, buffer };
    } catch (err) {
      console.warn('[borland] sample load failed.', err);
      return undefined;
    }
  }

  /** Decode + cache a chosen file and persist its bytes. Returns the ready entry. */
  async add(name: string, rootMidi: number, bytes: ArrayBuffer): Promise<SampleEntry> {
    if (bytes.byteLength > MAX_SAMPLE_BYTES) {
      throw new Error(
        `"${name}" is ${(bytes.byteLength / 1048576).toFixed(0)} MB — samples are capped at ${MAX_SAMPLE_BYTES / 1048576} MB.`,
      );
    }
    const id = makeId();
    const buffer = await bufferFromBytes(bytes);
    const meta: SampleMeta = { id, name, rootMidi };
    this.buffers.set(id, buffer);
    this.metas.set(id, meta);
    try {
      const db = await this.db();
      const record: SampleRecord = { ...meta, bytes };
      await reqDone(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
    } catch (err) {
      console.warn('[borland] sample persist failed (kept in memory for this session).', err);
    }
    return { ...meta, buffer };
  }

  /** Forget a sample (memory + IndexedDB). */
  async remove(id: string): Promise<void> {
    this.buffers.delete(id);
    this.metas.delete(id);
    try {
      const db = await this.db();
      await reqDone(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    } catch (err) {
      console.warn('[borland] sample remove failed.', err);
    }
  }
}

/** Process-wide sample store: the studio writes to it, sampler voices read from it. */
export const sampleStore = new SampleStore();

/**
 * Play a loaded sample once, straight to the destination — the studio's "just play".
 * Returns a stop() function; the player disposes itself when it finishes or is stopped.
 * Must be called from a user gesture (it unlocks the audio context).
 */
export async function previewSample(id: string): Promise<() => void> {
  const entry = await sampleStore.load(id);
  if (!entry) return () => undefined;
  await Tone.start();
  const player = new Tone.Player(entry.buffer).toDestination();
  player.onstop = () => player.dispose();
  player.start();
  return () => {
    try {
      player.stop();
    } catch {
      // already stopped/disposed — nothing to do
    }
  };
}
