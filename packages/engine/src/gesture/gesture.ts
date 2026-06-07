import { makePortRef } from '../core/ports';
import type { SignalRegistry } from '../core/registry';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Touch-first gestures → signal outputs (brief §10). Zoom (pinch / wheel / vertical
 * drag) is the primary gesture and maps to arc position; touch X/Y are exposed too.
 * Registered under the "gesture" pseudo-node so the matrix routes them onward — the
 * world changes because you touched it, not because you found a dial.
 */
export class GestureController {
  private zoom = 0; // 0..1 — arc position (0 = surface, 1 = the dark centre)
  private x = 0.5;
  private y = 0.5;
  private dragging = false;
  private lastY = 0;
  private pinchDist: number | null = null;
  private disposed = false;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd);
  }

  get arcPosition(): number {
    return this.zoom;
  }
  setArcPosition(v: number): void {
    this.zoom = clamp01(v);
  }

  registerPorts(registry: SignalRegistry): void {
    registry.addOutput(makePortRef('gesture', 'zoomDepth'), { kind: 'unipolar', read: () => this.zoom });
    registry.addOutput(makePortRef('gesture', 'touchX'), { kind: 'unipolar', read: () => this.x });
    registry.addOutput(makePortRef('gesture', 'touchY'), { kind: 'unipolar', read: () => this.y });
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = clamp01(this.zoom - e.deltaY * 0.0012); // scroll up = descend
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastY = e.clientY;
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      this.x = clamp01((e.clientX - r.left) / r.width);
      this.y = clamp01((e.clientY - r.top) / r.height);
    }
    if (this.dragging) {
      const dy = e.clientY - this.lastY;
      this.lastY = e.clientY;
      this.zoom = clamp01(this.zoom + dy * 0.003); // drag down = descend
    }
  };
  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };
  private readonly onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (this.pinchDist !== null) {
        this.zoom = clamp01(this.zoom + (dist - this.pinchDist) * 0.002); // pinch out = descend
      }
      this.pinchDist = dist;
    }
  };
  private readonly onTouchEnd = (): void => {
    this.pinchDist = null;
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('touchmove', this.onTouchMove);
    this.el.removeEventListener('touchend', this.onTouchEnd);
  }
}
