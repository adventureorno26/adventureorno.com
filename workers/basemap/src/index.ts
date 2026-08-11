// THE BASEMAP WORKER — copies the planet into R2, then serves it.
//
// docs/STATE.md Phase 4: the map has to be ours. MapTiler suspended the account
// and every map in the app went dark; Mapbox bills per tile request through
// MapLibre, which is the same shape of risk. Protomaps publishes the whole
// OpenStreetMap planet as ONE file that answers HTTP range requests, so owning
// the basemap means owning that file.
//
// WHY A WORKER DOES THE COPY. The file is 137.3 GB. Downloading it to a laptop
// and pushing it back up is 274 GB across a home connection. But the source is
// served FROM Cloudflare and R2 IS Cloudflare, so a Worker can read ranges and
// write them straight into the bucket without the bytes ever leaving their
// network. The copy is a multipart upload, resumable, driven one step at a time.
//
// State lives in the bucket itself (`<key>.copy-state.json`) rather than KV, so
// there is nothing else to provision and the copy can be resumed by anyone with
// the bucket.

export interface Env {
  BASEMAP: R2Bucket;
  SOURCE_URL: string;
  OBJECT_KEY: string;
}

/** R2 allows 10,000 parts. 100 MB × 1,373 covers 137.3 GB with room to spare,
 *  and each part is small enough to stream inside a Worker's memory budget. */
const PART_SIZE = 100 * 1024 * 1024;

interface CopyState {
  uploadId: string;
  key: string;
  source: string;
  total: number;
  partSize: number;
  /** Completed parts, in order. R2 needs the etags back to finish the upload. */
  parts: { partNumber: number; etag: string }[];
  done: boolean;
  startedAt: string;
}

const stateKey = (key: string) => `${key}.copy-state.json`;

async function readState(env: Env): Promise<CopyState | null> {
  const obj = await env.BASEMAP.get(stateKey(env.OBJECT_KEY));
  return obj ? ((await obj.json()) as CopyState) : null;
}

async function writeState(env: Env, s: CopyState): Promise<void> {
  await env.BASEMAP.put(stateKey(env.OBJECT_KEY), JSON.stringify(s), {
    httpMetadata: { contentType: 'application/json' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** How big is the source, and does it do ranges? Both are required. */
async function probeSource(url: string): Promise<{ total: number; ranges: boolean }> {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`source HEAD ${head.status}`);
  return {
    total: Number(head.headers.get('content-length') ?? 0),
    ranges: (head.headers.get('accept-ranges') ?? '').includes('bytes'),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ---- start: create the multipart upload and record the plan ------------
    if (url.pathname === '/copy/start') {
      const existing = await readState(env);
      if (existing && !existing.done) {
        return json({ error: 'a copy is already in progress', state: summary(existing) }, 409);
      }
      const { total, ranges } = await probeSource(env.SOURCE_URL);
      if (!total) return json({ error: 'source did not report a size' }, 502);
      if (!ranges) return json({ error: 'source does not support range requests' }, 502);

      const upload = await env.BASEMAP.createMultipartUpload(env.OBJECT_KEY, {
        httpMetadata: { contentType: 'application/octet-stream' },
      });
      const state: CopyState = {
        uploadId: upload.uploadId,
        key: env.OBJECT_KEY,
        source: env.SOURCE_URL,
        total,
        partSize: PART_SIZE,
        parts: [],
        done: false,
        startedAt: new Date().toISOString(),
      };
      await writeState(env, state);
      return json({ started: true, ...summary(state) });
    }

    // ---- step: copy the next N parts ---------------------------------------
    if (url.pathname === '/copy/step') {
      const state = await readState(env);
      if (!state) return json({ error: 'no copy in progress; call /copy/start' }, 404);
      if (state.done) return json(summary(state));

      // PARALLEL, because one stream is the bottleneck. A single 100 MB part
      // takes ~37s from the source (~2.7 MB/s), which would put the 137 GB copy
      // at about thirteen hours. The parts are independent — R2 accepts them in
      // any order — so a batch is fetched and uploaded concurrently and only
      // merged into the state once every one of them has succeeded.
      const n = Math.max(1, Math.min(24, Number(url.searchParams.get('n') ?? 8)));
      const upload = env.BASEMAP.resumeMultipartUpload(state.key, state.uploadId);
      const totalParts = Math.ceil(state.total / state.partSize);

      const first = state.parts.length + 1;
      const batch: number[] = [];
      for (let i = 0; i < n && first + i <= totalParts; i++) batch.push(first + i);

      if (batch.length > 0) {
        const results = await Promise.all(
          batch.map(async (partNumber) => {
            const start = (partNumber - 1) * state.partSize;
            const end = Math.min(start + state.partSize, state.total) - 1;
            const res = await fetch(state.source, { headers: { Range: `bytes=${start}-${end}` } });
            if (res.status !== 206 || !res.body) {
              // A short or wrong part is a corrupt archive that would only show
              // up as a broken tile months later. Fail the whole batch instead.
              throw new Error(`range ${start}-${end} returned ${res.status}`);
            }
            const uploaded = await upload.uploadPart(partNumber, res.body);
            return { partNumber, etag: uploaded.etag };
          }),
        ).catch((e: unknown) => {
          return e instanceof Error ? e : new Error(String(e));
        });

        if (results instanceof Error) {
          // Nothing is recorded, so the same batch is simply retried next call.
          return json({ error: results.message, ...summary(state) }, 502);
        }

        // Contiguous and in order, so a resumed copy can always work out where
        // it got to from the count alone.
        results.sort((a, b) => a.partNumber - b.partNumber);
        state.parts.push(...results);
      }

      if (state.parts.length >= totalParts) {
        await upload.complete(state.parts);
        state.done = true;
      }
      await writeState(env, state);
      return json(summary(state));
    }

    // ---- status -------------------------------------------------------------
    if (url.pathname === '/copy/status') {
      const state = await readState(env);
      if (!state) return json({ state: 'not started' });
      const head = await env.BASEMAP.head(state.key);
      return json({ ...summary(state), objectInBucket: head ? head.size : null });
    }

    // ---- abort ---------------------------------------------------------------
    if (url.pathname === '/copy/abort') {
      const state = await readState(env);
      if (!state) return json({ error: 'nothing to abort' }, 404);
      if (!state.done) {
        await env.BASEMAP.resumeMultipartUpload(state.key, state.uploadId).abort();
      }
      await env.BASEMAP.delete(stateKey(env.OBJECT_KEY));
      return json({ aborted: true });
    }

    // Proves the route is wired to our own domain before any tile depends on it.
    if (url.pathname === '/basemap/health') {
      const head = await env.BASEMAP.head(env.OBJECT_KEY);
      const state = await readState(env);
      return json({
        ok: true,
        servedFrom: url.host,
        planet: head ? { bytes: head.size } : 'copy not finished',
        copy: state ? summary(state) : 'not started',
      });
    }

    return json({ error: 'not found' }, 404);
  },
};

function summary(s: CopyState) {
  const totalParts = Math.ceil(s.total / s.partSize);
  const copied = s.parts.length * s.partSize;
  return {
    done: s.done,
    parts: `${s.parts.length}/${totalParts}`,
    copiedBytes: Math.min(copied, s.total),
    totalBytes: s.total,
    percent: Math.round((Math.min(copied, s.total) / s.total) * 1000) / 10,
    startedAt: s.startedAt,
  };
}
