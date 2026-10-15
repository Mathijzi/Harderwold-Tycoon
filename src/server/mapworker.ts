// Worker thread for the map editor: builds and diagnoses edited maps off the main thread (the game loop and the
// SSE stream keep running). Keeps the most recent built networks for route queries.
import { parentPort } from 'node:worker_threads';
import { diagnose, houseRoutes, routePts } from '../sim/diagnose.ts';
import type { MapBundle } from '../shared/mapdoc.ts';
import type { Network } from '../sim/network.ts';

const built = new Map<string, { net: Network; bundle: MapBundle }>();
parentPort!.on('message', (m: { id: number; op: 'diagnose' | 'route'; diagId?: string; bundle?: MapBundle; house?: number }) => {
  try {
    if (m.op === 'diagnose') {
      const { diag, net } = diagnose(m.bundle!);
      if (net) { built.set(m.diagId!, { net, bundle: m.bundle! }); while (built.size > 3) built.delete(built.keys().next().value!); }
      parentPort!.postMessage({ id: m.id, result: diag });
    } else {
      const b = built.get(m.diagId!);
      if (!b) { parentPort!.postMessage({ id: m.id, error: 'diag_expired' }); return; }
      const r = houseRoutes(b.net, m.house!);
      parentPort!.postMessage({ id: m.id, result: r && {
        house: m.house,
        in: r.in && { gate: r.in.id, lengthM: Math.round(r.in.len), pts: routePts(b.net, b.bundle, r.in.route) },
        out: r.out && { gate: r.out.id, lengthM: Math.round(r.out.len), pts: routePts(b.net, b.bundle, r.out.route) },
      } });
    }
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error).message });
  }
});
