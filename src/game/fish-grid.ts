import type { Fish } from "./world";

const CELL_SIZE = 128;

/** A step-local index of fish centres. Queries retain the World's order for seeded captures. */
export class FishGrid {
  private readonly rows = new Map<number, Map<number, number[]>>();
  private minX = Infinity;
  private maxX = -Infinity;
  private minY = Infinity;
  private maxY = -Infinity;

  constructor(private readonly fish: readonly Fish[]) {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]!;
      if (f.captured) continue;
      const x = Math.floor(f.x / CELL_SIZE);
      const y = Math.floor(f.y / CELL_SIZE);
      let row = this.rows.get(y);
      if (!row) this.rows.set(y, row = new Map());
      let cell = row.get(x);
      if (!cell) row.set(x, cell = []);
      cell.push(i);
      this.minX = Math.min(this.minX, x);
      this.maxX = Math.max(this.maxX, x);
      this.minY = Math.min(this.minY, y);
      this.maxY = Math.max(this.maxY, y);
    }
  }

  /** Conservative candidates for an expanded projectile segment; the caller tests exact hits. */
  query(left: number, top: number, right: number, bottom: number): Fish[] {
    const loX = Math.max(this.minX, Math.floor(left / CELL_SIZE));
    const hiX = Math.min(this.maxX, Math.floor(right / CELL_SIZE));
    const loY = Math.max(this.minY, Math.floor(top / CELL_SIZE));
    const hiY = Math.min(this.maxY, Math.floor(bottom / CELL_SIZE));
    const indices: number[] = [];
    for (let y = loY; y <= hiY; y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      for (let x = loX; x <= hiX; x++) {
        const cell = row.get(x);
        if (cell) for (const i of cell) indices.push(i);
      }
    }
    indices.sort((a, b) => a - b);
    return indices.map((i) => this.fish[i]!);
  }
}
