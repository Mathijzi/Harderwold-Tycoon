// SVG map of the editor in PDF points: PDF underlay, terrain, roads with lane arrows, gates, parking, houses,
// facilities and diagnostics overlays. Pan (drag the background), zoom (wheel), drag handles to correct positions.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapBundle } from '../../shared/mapdoc.ts';
import type { Diagnosis } from '../../sim/diagnose.ts';
import { Sel, Pt, PolyLayer, roadCtrl, smooth, facilities, polys, sameSel, posOf } from './model.ts';

export interface Layers { pdf: boolean; pdfOpacity: number; terrain: boolean; roads: boolean; arrows: boolean; nodes: boolean; gates: boolean; parking: boolean; houses: boolean; labels: boolean; facilities: boolean; diag: boolean }
export type Tool = 'select' | 'addRoad' | 'measure' | 'editPoly';
export interface View { x: number; y: number; w: number; h: number }
export interface RouteView { in?: { gate: string; pts: Pt[] }; out?: { gate: string; pts: Pt[] } }

interface Props {
  doc: MapBundle; layers: Layers; tool: Tool; sel: Sel; diag: Diagnosis | null; route: RouteView | null;
  view: View; setView: (v: View) => void;
  onSelect: (s: Sel) => void;
  onDragStart: (s: Sel) => void; onDrag: (s: Sel, p: Pt) => void; onDragEnd: () => void;
  onRoadDouble: (road: string, p: Pt) => void;
  onNodeForRoad: (node: string) => void; roadFrom: string | null;
  onCursor: (p: Pt | null) => void;
  measure: Pt[]; setMeasure: (m: Pt[]) => void;
}

const CLS_COL: Record<string, string> = { public: '#6d7a85', arrival: '#3a6ea5', park: '#59636b', service: '#c07a1d', scenery: '#9aa' };
const CONF_COL: Record<string, string> = { high: '#2f8f4e', medium: '#d08a12', low: '#cf3a2b', reviewed: '#2c6fcf' };

export function MapView(p: Props) {
  const { doc, layers, view, sel, diag } = p;
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const drag = useRef<{ kind: 'pan' | 'obj'; sel?: Sel; sx: number; sy: number; v0: View; moved: boolean; off: Pt } | null>(null);
  const k = doc.park.metersPerPt;

  useEffect(() => {
    const el = svg.current!; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // keep the aspect ratio of the element
  const vb = useMemo(() => {
    // the whole view rectangle stays visible: extend it in the direction the element has room for
    const a = size.w / Math.max(1, size.h);
    if (view.w / view.h >= a) { const h = view.w / a; return { x: view.x, y: view.y + (view.h - h) / 2, w: view.w, h }; }
    const w = view.h * a; return { x: view.x + (view.w - w) / 2, y: view.y, w, h: view.h };
  }, [view, size]);
  const px = vb.w / Math.max(1, size.w); // PDF points per screen pixel

  const toPt = (cx: number, cy: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [vb.x + ((cx - r.left) / r.width) * vb.w, vb.y + ((cy - r.top) / r.height) * vb.h];
  };

  // wheel zoom around the cursor (non-passive listener so the page does not scroll)
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0015);
      const [mx, my] = toPt(e.clientX, e.clientY);
      const w = Math.max(15, Math.min(900, vb.w * f)), s = w / vb.w;
      p.setView({ x: mx - (mx - vb.x) * s, y: my - (my - vb.y) * s, w, h: vb.h * s });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const down = (e: React.PointerEvent, s: Sel) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.stopPropagation();
    const pt = toPt(e.clientX, e.clientY);
    if (p.tool === 'measure') { p.setMeasure(p.measure.length >= 2 ? [pt] : [...p.measure, pt]); return; }
    if (p.tool === 'addRoad' && s?.kind === 'node') { p.onNodeForRoad(s.id); return; }
    if (!s || e.button === 1) { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: view, moved: false, off: [0, 0] }; }
    else {
      p.onSelect(s);
      const at = posOf(doc, s);
      const movable = !!at && s.kind !== 'road' && s.kind !== 'poly';
      drag.current = movable ? { kind: 'obj', sel: s, sx: e.clientX, sy: e.clientY, v0: view, moved: false, off: [at![0] - pt[0], at![1] - pt[1]] } : { kind: 'pan', sx: e.clientX, sy: e.clientY, v0: view, moved: false, off: [0, 0] };
    }
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const pt = toPt(e.clientX, e.clientY);
    p.onCursor(pt);
    const d = drag.current; if (!d) return;
    const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (!d.moved && dist < 3) return;
    if (d.kind === 'pan') {
      d.moved = true;
      const dx = (e.clientX - d.sx) * px, dy = (e.clientY - d.sy) * px;
      p.setView({ ...d.v0, x: d.v0.x - dx, y: d.v0.y - dy });
    } else {
      if (!d.moved) { d.moved = true; p.onDragStart(d.sel!); }
      p.onDrag(d.sel!, [Math.round((pt[0] + d.off[0]) * 10) / 10, Math.round((pt[1] + d.off[1]) * 10) / 10]);
    }
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === 'pan' && !d.moved && p.tool === 'select') p.onSelect(null);
    if (d.kind === 'obj' && d.moved) p.onDragEnd();
  };

  // ------------------------------------------------------------ derived geometry
  const roads = useMemo(() => doc.network.roads.map((r) => {
    const ctrl = roadCtrl(doc, r), c = smooth(ctrl);
    const two = !r.oneway, lw = two ? (r.laneOffsetM * 2 + 2.6) / k : 3.0 / k;
    const arrows: { x: number; y: number; a: number }[] = [];
    let acc = 6;
    for (let i = 0; i < c.length - 1; i++) {
      const [ax, ay] = c[i], [bx, by] = c[i + 1], L = Math.hypot(bx - ax, by - ay); if (!L) continue;
      const tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty, ny = tx;
      while (acc < L) {
        const x = ax + tx * acc, y = ay + ty * acc, off = r.laneOffsetM / k;
        if (r.oneway !== 'b') arrows.push({ x: x + nx * (two ? off : 0), y: y + ny * (two ? off : 0), a: Math.atan2(ty, tx) });
        if (r.oneway !== 'f') arrows.push({ x: x - nx * (two ? off : 0), y: y - ny * (two ? off : 0), a: Math.atan2(-ty, -tx) });
        acc += 14;
      }
      acc -= L;
    }
    return { r, ctrl, d: 'M' + c.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join('L'), lw, arrows };
  }), [doc.network, k]);
  const diagHouse = useMemo(() => new Map((diag?.derived.houses ?? []).map((h) => [h.number, h])), [diag]);
  const problemsAt = useMemo(() => {
    if (!diag || !layers.diag) return [];
    const out: { pt: Pt; level: string }[] = [];
    for (const pr of diag.problems) {
      if (!pr.ref || pr.level === 'info') continue;
      const s: Sel = pr.ref.kind === 'house' ? { kind: 'house', num: Number(pr.ref.id) } : pr.ref.kind === 'gate' ? { kind: 'gate', id: pr.ref.id } : pr.ref.kind === 'road' ? { kind: 'road', id: pr.ref.id } : pr.ref.kind === 'parking' ? { kind: 'parking', id: pr.ref.id } : null;
      const at = posOf(doc, s); if (at) out.push({ pt: at, level: pr.level });
    }
    return out;
  }, [diag, doc, layers.diag]);

  const hs = 4.5 * px; // handle radius: constant on screen
  const isSel = (s: Sel) => sameSel(s, sel);
  const selRoad = sel?.kind === 'road' ? sel.id : sel?.kind === 'rpt' ? sel.road : null;
  const polyLayers: PolyLayer[] = ['water', 'footpaths', 'roadSurfaces', 'structures'];
  const polyFill: Record<PolyLayer, string> = { water: '#7fb6d8', footpaths: '#e2cfa3', roadSurfaces: '#b9bec2', structures: '#8d8f86' };
  const vp = doc.park.viewPts;

  return (
    <svg ref={svg} className={`map tool-${p.tool}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={(e) => down(e, null)} onPointerMove={move} onPointerUp={up} onPointerLeave={() => p.onCursor(null)}>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="var(--map-bg)" />
      {layers.pdf && <image href="/assets/editor_pdf.jpg" x={186} y={4} width={474} height={396} opacity={layers.pdfOpacity} preserveAspectRatio="none" />}
      <rect x={vp[0]} y={vp[1]} width={vp[2] - vp[0]} height={vp[3] - vp[1]} fill="none" stroke="#888" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />

      {layers.terrain && polyLayers.map((L) => polys(doc, L).map((P, i) => {
        const s: Sel = { kind: 'poly', layer: L, i };
        const on = isSel(s) || (sel?.kind === 'vertex' && sel.layer === L && sel.i === i);
        return <polygon key={`${L}${i}`} points={P.map((q) => q.join(',')).join(' ')} fill={polyFill[L]} fillOpacity={L === 'structures' ? 0.45 : 0.35}
          stroke={on ? '#e0457b' : 'none'} strokeWidth={2} vectorEffect="non-scaling-stroke"
          onPointerDown={p.tool === 'editPoly' ? (e) => down(e, s) : undefined} style={{ pointerEvents: p.tool === 'editPoly' ? 'all' : 'none' }} />;
      }))}
      {layers.terrain && (sel?.kind === 'poly' || sel?.kind === 'vertex') && (() => {
        const P = polys(doc, sel.layer)[sel.i]; if (!P) return null;
        const closed = P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1];
        return P.slice(0, closed ? -1 : undefined).map((q, v) => <circle key={`v${v}`} cx={q[0]} cy={q[1]} r={hs * 0.8} className={`h vtx${sel.kind === 'vertex' && sel.v === v ? ' on' : ''}`} onPointerDown={(e) => down(e, { kind: 'vertex', layer: sel.layer, i: sel.i, v })} />);
      })()}

      {layers.roads && roads.map(({ r, d, lw }) => (
        <path key={r.id} d={d} fill="none" stroke={selRoad === r.id ? '#e0457b' : CLS_COL[r.class] ?? '#666'} strokeOpacity={selRoad === r.id ? 0.55 : 0.4} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round"
          className="road" onPointerDown={(e) => down(e, { kind: 'road', id: r.id })} onDoubleClick={(e) => p.onRoadDouble(r.id, toPt(e.clientX, e.clientY))} />
      ))}
      {layers.roads && roads.map(({ r, d }) => <path key={`c${r.id}`} d={d} fill="none" stroke={r.oneway ? '#7a2fb5' : '#fff'} strokeWidth={r.oneway ? 1.6 : 0.8} strokeDasharray={r.class === 'service' ? '4 3' : undefined} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {layers.arrows && px < 0.5 && roads.flatMap(({ r, arrows }) => arrows.map((a, i) => (
        <path key={`a${r.id}${i}`} d="M-1.3,-0.8 L1.2,0 L-1.3,0.8 Z" transform={`translate(${a.x},${a.y}) rotate(${(a.a * 180) / Math.PI}) scale(${Math.min(1, 7 * px)})`} fill={r.oneway ? '#7a2fb5' : '#1d2a33'} opacity={0.85} pointerEvents="none" />
      )))}
      {selRoad && (() => {
        const r = doc.network.roads.find((x) => x.id === selRoad); if (!r) return null;
        return <>
          <polyline points={roadCtrl(doc, r).map((q) => q.join(',')).join(' ')} fill="none" stroke="#e0457b" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          {r.pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={hs * 0.8} className={`h rpt${isSel({ kind: 'rpt', road: r.id, i }) ? ' on' : ''}`} onPointerDown={(e) => down(e, { kind: 'rpt', road: r.id, i })} />)}
        </>;
      })()}

      {diag && layers.parking && diag.derived.stalls.map((s) => (
        <polygon key={s.id} points={s.pad.map((q) => q.join(',')).join(' ')} fill={s.kind === 'house' ? '#f1e9c9' : s.kind === 'depot' ? '#9fd3c7' : '#ddd'} stroke="#7d6a35" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
          opacity={sel?.kind === 'house' && diagHouse.get(sel.num)?.stallId === s.id ? 1 : 0.8} pointerEvents="none" />
      ))}
      {layers.parking && doc.park.parkingClusters.map((c) => (
        <g key={c.id} onPointerDown={(e) => down(e, { kind: 'parking', id: c.id })} className="obj">
          <rect x={c.pt[0] - hs} y={c.pt[1] - hs} width={hs * 2} height={hs * 2} rx={hs * 0.3} fill={isSel({ kind: 'parking', id: c.id }) ? '#e0457b' : '#2c6fcf'} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {px < 0.35 && <text x={c.pt[0]} y={c.pt[1] + hs * 0.45} fontSize={hs * 1.2} textAnchor="middle" fill="#fff" pointerEvents="none">{c.stalls}</text>}
        </g>
      ))}

      {layers.houses && doc.park.houses.map((h) => {
        const dh = diagHouse.get(h.number);
        const side = (h as { footprintPts?: number }).footprintPts ?? 6;
        const ang = h.frontDeg ?? dh?.frontDeg ?? h.pdfRotationDeg ?? 0;
        const s: Sel = { kind: 'house', num: h.number }, on = isSel(s);
        const col = CONF_COL[h.typeConfidence] ?? '#555';
        return (
          <g key={h.number} className="obj" onPointerDown={(e) => down(e, s)}>
            {diag && layers.diag && dh && dh.adjustedM > 1 && <>
              <line x1={h.pt[0]} y1={h.pt[1]} x2={dh.pt[0]} y2={dh.pt[1]} stroke="#e0457b" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              <rect x={dh.pt[0] - (side * dh.scale) / 2} y={dh.pt[1] - (side * dh.scale) / 2} width={side * dh.scale} height={side * dh.scale} transform={`rotate(${dh.frontDeg} ${dh.pt[0]} ${dh.pt[1]})`} fill="none" stroke="#e0457b" strokeDasharray="2 2" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            </>}
            <g transform={`translate(${h.pt[0]},${h.pt[1]}) rotate(${ang})`}>
              <rect x={-side / 2} y={-side / 2} width={side} height={side} fill={col} fillOpacity={on ? 0.9 : 0.55} stroke={on ? '#e0457b' : h.locked ? '#111' : '#fff'} strokeWidth={on ? 2.5 : 1} strokeDasharray={h.locked ? '3 2' : undefined} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={0} x2={side / 2 + 1.5} y2={0} stroke="#111" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
            </g>
            {layers.labels && px < 0.45 && <text x={h.pt[0]} y={h.pt[1] - side / 2 - 0.8} fontSize={11 * px} textAnchor="middle" className="lbl" style={{ strokeWidth: 3 * px }}>{h.number}</text>}
          </g>
        );
      })}

      {layers.facilities && facilities(doc).map((f, i) => (
        <g key={i} className="obj" onPointerDown={(e) => down(e, { kind: 'facility', i })}>
          <circle cx={f.pt[0]} cy={f.pt[1]} r={hs * 1.2} fill={isSel({ kind: 'facility', i }) ? '#e0457b' : '#0f8f83'} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={f.pt[0]} y={f.pt[1] + hs * 0.45} fontSize={hs * 1.3} textAnchor="middle" fill="#fff" fontWeight={700} pointerEvents="none">{f.key}</text>
        </g>
      ))}

      {layers.nodes && Object.entries(doc.network.nodes).map(([id, n]) => {
        const s: Sel = { kind: 'node', id }, on = isSel(s) || p.roadFrom === id;
        return <rect key={id} x={n.pt[0] - hs * 0.8} y={n.pt[1] - hs * 0.8} width={hs * 1.6} height={hs * 1.6} transform={`rotate(45 ${n.pt[0]} ${n.pt[1]})`}
          className={`h node k-${n.kind}${on ? ' on' : ''}`} onPointerDown={(e) => down(e, s)} />;
      })}

      {layers.gates && doc.network.gates.map((g) => {
        const s: Sel = { kind: 'gate', id: g.id }, dg = diag?.derived.gates.find((x) => x.id === g.id);
        return (
          <g key={g.id} className="obj" onPointerDown={(e) => down(e, s)}>
            {dg && dg.slots.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={hs * 0.7} fill="none" stroke={g.direction === 'inbound' ? '#18a058' : '#d9423a'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
            <circle cx={g.stopPt[0]} cy={g.stopPt[1]} r={hs * 1.3} fill={isSel(s) ? '#e0457b' : g.staff ? '#1f5fa8' : g.direction === 'inbound' ? '#18a058' : '#d9423a'} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <text x={g.stopPt[0] + hs * 1.8} y={g.stopPt[1] + hs * 0.5} fontSize={12 * px} className="lbl" style={{ strokeWidth: 3 * px }}>{g.id}</text>
          </g>
        );
      })}

      {p.route?.in && <polyline points={p.route.in.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#18a058" strokeWidth={3} strokeOpacity={0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {p.route?.out && <polyline points={p.route.out.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#d9423a" strokeWidth={3} strokeOpacity={0.7} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {problemsAt.map((q, i) => <circle key={`pr${i}`} cx={q.pt[0]} cy={q.pt[1]} r={hs * 2.2} fill="none" stroke={q.level === 'error' ? '#d9001b' : '#e08a00'} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {p.measure.length > 0 && <>
        <polyline points={p.measure.map((q) => q.join(',')).join(' ')} fill="none" stroke="#111" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {p.measure.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={hs * 0.6} fill="#111" />)}
        {p.measure.length === 2 && <text x={(p.measure[0][0] + p.measure[1][0]) / 2} y={(p.measure[0][1] + p.measure[1][1]) / 2 - hs} fontSize={14 * px} className="lbl meas" style={{ strokeWidth: 3 * px }}>
          {(Math.hypot(p.measure[1][0] - p.measure[0][0], p.measure[1][1] - p.measure[0][1]) * k).toFixed(1)} m
        </text>}
      </>}
    </svg>
  );
}
