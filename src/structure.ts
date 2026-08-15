import type { Connection, StructuralElement, StructureScene } from "./types";

/** Deterministic PRNG for organic irregularity (not random UI data). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Bottom-rooted branching schematic inspired by system simulation reference.
 * F/E on modules are structural placeholders (SIM), not acoustic measurements.
 */
export function createFoundationScene(
  width: number,
  height: number
): StructureScene {
  const left = width * 0.26;
  const right = width * 0.92;
  const top = height * 0.1;
  const bottom = height * 0.72;
  const cx = (left + right) * 0.5;
  const rootY = bottom - 8;

  const elements: StructuralElement[] = [];
  const connections: Connection[] = [];
  const ghosts: StructureScene["ghosts"] = [];
  let seq = 0;
  let markerSeq = 8;

  const idOf = () => {
    seq += 1;
    return `N-${String(seq).padStart(2, "0")}`;
  };

  const add = (el: StructuralElement) => {
    elements.push(el);
    return el.id;
  };

  const link = (
    from: string,
    to: string,
    style: Connection["style"] = "straight",
    signal = false
  ) => {
    connections.push({
      id: `E-${connections.length + 1}`,
      from,
      to,
      style,
      bias: 0.45 + hash(connections.length) * 0.2,
      signal,
    });
  };

  const rootId = add({
    id: "N-00",
    kind: "root",
    x: cx,
    y: rootY,
    size: 6,
    label: "N-00 ROOT",
    energy: 1,
    accent: true,
  });

  type Tip = { id: string; x: number; y: number; angle: number; depth: number };
  const tips: Tip[] = [
    { id: rootId, x: cx, y: rootY, angle: -Math.PI / 2, depth: 0 },
  ];

  const callouts: Array<{ id: string; depth: number }> = [];
  const maxDepth = 8;

  // Grow upward with asymmetric forks
  for (let depth = 0; depth < maxDepth; depth++) {
    const current = tips.splice(0, tips.length);
    for (let i = 0; i < current.length; i++) {
      const tip = current[i];
      const forks =
        depth === 0
          ? 3
          : depth < 3
            ? hash(depth * 10 + i) > 0.35
              ? 2
              : 1
            : hash(depth * 17 + i) > 0.55
              ? 2
              : 1;

      for (let f = 0; f < forks; f++) {
        const spread =
          depth === 0
            ? (f - 1) * 0.62
            : (f - (forks - 1) / 2) * (0.4 + hash(seq + f) * 0.3);
        const ang = tip.angle + spread + (hash(seq * 3 + f) - 0.5) * 0.28;
        const len =
          (42 - depth * 3.2) *
          (0.8 + hash(seq + depth) * 0.5) *
          (height / 860);
        let nx = tip.x + Math.cos(ang) * len;
        let ny = tip.y + Math.sin(ang) * len;
        nx = Math.max(left + 20, Math.min(right - 20, nx));
        ny = Math.max(top + 20, Math.min(rootY - 20, ny));

        const kindRoll = hash(seq * 9 + f + depth);
        let id: string;
        const energy = Number((0.55 + hash(seq + 1) * 0.4).toFixed(2));

        if ((kindRoll > 0.72 || depth === 2) && depth > 0) {
          markerSeq += 1;
          id = add({
            id: idOf(),
            kind: "marker",
            x: nx,
            y: ny,
            size: 8,
            index: markerSeq,
            energy,
          });
        } else if (kindRoll > 0.5) {
          id = add({
            id: idOf(),
            kind: "junction",
            x: nx,
            y: ny,
            size: 4.5 + hash(seq) * 2,
            energy,
          });
        } else {
          id = add({
            id: idOf(),
            kind: "square",
            x: nx,
            y: ny,
            size: 2.2 + hash(seq) * 1.4,
            energy,
          });
        }

        const signal = depth < 3 || hash(seq + 4) > 0.55;
        const style: Connection["style"] =
          hash(seq + 1) > 0.7 ? "curve" : "straight";
        link(tip.id, id, style, signal);

        if (depth >= 1 && hash(seq + 7) > 0.7) {
          callouts.push({ id, depth });
        }

        tips.push({ id, x: nx, y: ny, angle: ang, depth: depth + 1 });
      }
    }
  }

  // Labeled modules attached to selected nodes (structural SIM values)
  const moduleTargets = callouts.filter((_, i) => i % 2 === 0).slice(0, 10);
  const extras = elements.filter((e) => e.kind === "square" || e.kind === "junction");
  while (moduleTargets.length < 10 && extras.length) {
    const e = extras[(moduleTargets.length * 5) % extras.length];
    if (!moduleTargets.some((t) => t.id === e.id)) {
      moduleTargets.push({ id: e.id, depth: 2 });
    } else {
      break;
    }
  }

  for (let i = 0; i < moduleTargets.length; i++) {
    const target = elements.find((e) => e.id === moduleTargets[i].id);
    if (!target) continue;
    const side = i % 2 === 0 ? -1 : 1;
    const mx = target.x + side * (48 + hash(i) * 32);
    const my = target.y - 12 + (hash(i + 3) - 0.5) * 28;
    const mid = add({
      id: `M-${target.id}`,
      kind: "module",
      x: Math.max(left + 40, Math.min(right - 40, mx)),
      y: Math.max(top + 30, Math.min(bottom - 40, my)),
      size: 0,
      w: 76,
      h: 46,
      label: target.id,
      fit: Math.round(80 + hash(i * 11) * 280),
      energy: Number((0.6 + hash(i * 13) * 0.35).toFixed(2)),
      accent: i === 0 || i === 3 || i === 7,
    });
    link(target.id, mid, "straight", i < 3);
  }

  // Sparse ghosts / fragments
  for (let g = 0; g < 28; g++) {
    ghosts.push({
      x: left + hash(g * 2.1) * (right - left),
      y: top + hash(g * 3.7) * (bottom - top),
      s: 1 + hash(g * 5.3) * 2.5,
    });
  }

  return { elements, connections, ghosts };
}
