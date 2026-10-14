/** Coordinates are local to the tree, so pinch anchors match its world transform. */
export interface TreeView { x: number; y: number; scale: number }
export interface TreePointer { id: number; x: number; y: number; pointerType: string; nodeId: string | null }
interface TrackedPointer extends TreePointer { startX: number; startY: number; moved: boolean }
interface Pinch { x: number; y: number; distance: number; view: TreeView }
const DRAG_THRESHOLD = 5;

export class TreeGestures {
  suppressClick = false;
  panning = false;
  private pointers = new Map<number, TrackedPointer>();
  private baseView: TreeView = { x: 0, y: 0, scale: 1 };
  private currentView = this.baseView;
  private pinch: Pinch | null = null;

  down(pointer: TreePointer, view: TreeView): void {
    if (this.pointers.size === 0) {
      this.suppressClick = false;
      this.baseView = { ...view };
      this.currentView = { ...view };
    }
    this.pointers.set(pointer.id, { ...pointer, startX: pointer.x, startY: pointer.y, moved: false });
    if (this.pointers.size > 1) {
      for (const p of this.pointers.values()) p.moved = true;
      this.panning = true;
      this.suppressClick = true;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, distance: Math.max(1, Math.hypot(b!.x - a!.x, b!.y - a!.y)), view: { ...view } };
    }
  }

  move(pointer: TreePointer, view: TreeView, minimum: number, maximum: number): TreeView | null {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked) return null;
    tracked.x = pointer.x;
    tracked.y = pointer.y;
    if (this.pinch && this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      const x = (a!.x + b!.x) / 2;
      const y = (a!.y + b!.y) / 2;
      const distance = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      const scale = Math.min(maximum, Math.max(minimum, this.pinch.view.scale * distance / this.pinch.distance));
      const ratio = scale / this.pinch.view.scale;
      this.currentView = { x: x - (this.pinch.x - this.pinch.view.x) * ratio, y: y - (this.pinch.y - this.pinch.view.y) * ratio, scale };
    } else {
      const dx = pointer.x - tracked.startX;
      const dy = pointer.y - tracked.startY;
      if (!tracked.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return null;
      tracked.moved = true;
      this.panning = true;
      this.suppressClick = true;
      this.currentView = { x: this.baseView.x + dx, y: this.baseView.y + dy, scale: view.scale };
    }
    return this.currentView;
  }

  up(pointer: TreePointer): { selection: string | null; touchTap: boolean } {
    const tracked = this.pointers.get(pointer.id);
    if (!tracked) return { selection: null, touchTap: false };
    const moved = tracked.moved || Math.hypot(pointer.x - tracked.startX, pointer.y - tracked.startY) >= DRAG_THRESHOLD;
    const touch = tracked.pointerType === "touch";
    this.suppressClick ||= touch || moved;
    this.pointers.delete(pointer.id);
    this.pinch = null;
    // The remaining finger starts from the last pinch transform, not its original press.
    this.baseView = { ...this.currentView };
    for (const p of this.pointers.values()) {
      p.startX = p.x;
      p.startY = p.y;
      p.moved = true;
    }
    this.panning = this.pointers.size > 0;
    return { selection: touch && !moved ? tracked.nodeId : null, touchTap: touch && !moved };
  }

  cancelAll(): number[] {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.pinch = null;
    this.panning = false;
    this.suppressClick = true;
    return ids;
  }

  cancel(id: number): number[] {
    return this.pointers.has(id) ? this.cancelAll() : [];
  }
}
