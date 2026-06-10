import { makePortRef } from '../core/ports';
import type { SignalRegistry } from '../core/registry';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Two taps closer than this (ms / px) read as a double-tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 40;
/** A press that travels further than this is a drag, not a tap. */
const TAP_SLOP_PX = 12;

/**
 * Touch-first gestures → signal outputs (brief §10). Zoom (pinch / wheel / vertical
 * drag) is the primary gesture and maps to arc position; touch X/Y are exposed too.
 * Registered under the "gesture" pseudo-node so the matrix routes them onward — the
 * world changes because you touched it, not because you found a dial.
 *
 * A clean DOUBLE-TAP (or double-click) fires `onDoubleTap` — the player uses it to
 * advance to the next scene. Multi-finger gestures and drags never count as taps,
 * and any zoom-adjusting input raises a flag the host consumes to cancel an
 * in-flight programmatic arc glide: the hand always wins.
 */
export class GestureController {
  private zoom = 0; // 0..1 — arc position (0 = surface, 1 = the dark centre)
  private x = 0.5;
  private y = 0.5;
  private dragging = false;
  private lastY = 0;
  private pinchDist: number | null = null;
  private disposed = false;

  /** Fired on a clean double-tap/double-click (not a pinch, not a drag). */
  onDoubleTap: (() => void) | null = null;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private downPos: { x: number; y: number } | null = null;
  private activePointers = 0;
  private maxPointers = 0;
  private userAdjusted = false;

  constructor(private readonly el: HTMLElement) {
    // Suppress iOS double-tap zoom / scroll on the canvas — the element IS the
    // instrument, so the browser must not interpret its gestures.
    el.style.touchAction = 'none';
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

  /** True once if the user adjusted the zoom since the last call — the host
   *  polls this each frame to hand control back mid-glide. */
  consumeUserAdjust(): boolean {
    const v = this.userAdjusted;
    this.userAdjusted = false;
    return v;
  }

  registerPorts(registry: SignalRegistry): void {
    registry.addOutput(makePortRef('gesture', 'zoomDepth'), { kind: 'unipolar', read: () => this.zoom });
    registry.addOutput(makePortRef('gesture', 'touchX'), { kind: 'unipolar', read: () => this.x });
    registry.addOutput(makePortRef('gesture', 'touchY'), { kind: 'unipolar', read: () => this.y });
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = clamp01(this.zoom - e.deltaY * 0.002); // scroll up = descend
    this.userAdjusted = true;
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastY = e.clientY;
    this.activePointers += 1;
    this.maxPointers = Math.max(this.maxPointers, this.activePointers);
    this.downPos = { x: e.clientX, y: e.clientY };
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
      if (dy !== 0) {
        this.zoom = clamp01(this.zoom + dy * 0.005); // drag down = descend
        this.userAdjusted = true;
      }
    }
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    this.dragging = false;
    this.activePointers = Math.max(0, this.activePointers - 1);
    if (this.activePointers > 0) return; // still mid multi-touch
    const wasMulti = this.maxPointers > 1;
    this.maxPointers = 0;
    const down = this.downPos;
    this.downPos = null;
    if (wasMulti || !down) return; // pinches and stray ups never count as taps
    const travelled = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (travelled > TAP_SLOP_PX) return; // a drag, not a tap
    const now = e.timeStamp;
    const prev = this.lastTap;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX
    ) {
      this.lastTap = null; // a triple tap should not fire twice
      this.onDoubleTap?.();
    } else {
      this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  private readonly onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (this.pinchDist !== null) {
        this.zoom = clamp01(this.zoom + (dist - this.pinchDist) * 0.004); // pinch out = descend
        this.userAdjusted = true;
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
