import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Maximize2, RotateCcw } from 'lucide-react';

/** How much room the content has to work with. Widgets branch on this rather
    than on raw pixels, so "what changes at what width" is decided once here
    instead of being re-guessed with different breakpoints in every widget. */
export type SizeBucket = 'sm' | 'md' | 'lg';

export interface DialogSize {
  width: number;
  height: number;
  bucket: SizeBucket;
  /** Usable height for a chart once header/controls/footer are accounted for */
  chartHeight: number;
}

const MIN_W = 360;
const MIN_H = 320;
/** Leave a margin so the dialog can never be dragged under the viewport edge */
const VIEWPORT_MARGIN = 32;

function bucketFor(width: number): SizeBucket {
  if (width < 560) return 'sm';
  if (width < 900) return 'md';
  return 'lg';
}

function clamp(w: number, h: number) {
  const maxW = Math.max(MIN_W, window.innerWidth - VIEWPORT_MARGIN);
  const maxH = Math.max(MIN_H, window.innerHeight - VIEWPORT_MARGIN);
  return {
    width: Math.min(Math.max(w, MIN_W), maxW),
    height: Math.min(Math.max(h, MIN_H), maxH),
  };
}

interface ResizableDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Per-widget localStorage key, so each popup remembers its own size */
  storageKey: string;
  defaultWidth: number;
  defaultHeight: number;
  /** Rendered with the current size so content can reflow, not just rescale */
  children: (size: DialogSize) => ReactNode;
}

/** A dashboard detail popup the Manager can resize by dragging its
    bottom-right corner. The size is remembered per widget, and is passed
    back down to the content as a bucket - so a wider popup doesn't merely
    stretch the same layout, it gets a layout suited to the space (more
    columns, taller charts, fuller labels). */
export function ResizableDialog({
  open, onClose, title, storageKey, defaultWidth, defaultHeight, children,
}: ResizableDialogProps) {
  const [size, setSize] = useState(() => ({ width: defaultWidth, height: defaultHeight }));
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Restore on open (not on mount) and re-clamp to the window as it is now -
  // a size saved on a big monitor must not open off-screen on a laptop.
  useEffect(() => {
    if (!open) return;
    let next = { width: defaultWidth, height: defaultHeight };
    try {
      const raw = localStorage.getItem(`dlgsize:${storageKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') next = parsed;
      }
    } catch { /* corrupt/unavailable storage just falls back to the default */ }
    setSize(clamp(next.width, next.height));
  }, [open, storageKey, defaultWidth, defaultHeight]);

  const persist = useCallback((s: { width: number; height: number }) => {
    try { localStorage.setItem(`dlgsize:${storageKey}`, JSON.stringify(s)); } catch { /* non-critical */ }
  }, [storageKey]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      // x2 because the dialog is centre-anchored: it grows from both edges,
      // so the pointer travels half the distance the width actually changes.
      setSize(clamp(st.w + (e.clientX - st.x) * 2, st.h + (e.clientY - st.y) * 2));
    };
    const onUp = () => {
      setDragging(false);
      dragState.current = null;
      setSize(s => { persist(s); return s; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, persist]);

  // Keep an open dialog inside the window if the window itself shrinks.
  useEffect(() => {
    if (!open) return;
    const onResize = () => setSize(s => clamp(s.width, s.height));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragState.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };
    setDragging(true);
  };

  const fitToScreen = () => {
    const s = clamp(window.innerWidth - VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN);
    setSize(s); persist(s);
  };
  const resetSize = () => {
    const s = clamp(defaultWidth, defaultHeight);
    setSize(s); persist(s);
  };

  const bucket = bucketFor(size.width);
  // Header + control row + the resize gutter, subtracted once here so every
  // widget's chart gets a height that actually fits instead of overflowing.
  const chartHeight = Math.max(140, size.height - (bucket === 'sm' ? 300 : 260));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="!max-w-none overflow-hidden p-0"
        style={{
          width: size.width, height: size.height, maxWidth: 'none',
          display: 'flex', flexDirection: 'column', gap: 0,
          // Suppress the open/close zoom while dragging or the dialog
          // visibly lags the pointer on every size change.
          transitionProperty: dragging ? 'none' : undefined,
        }}
      >
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
            <div className="flex items-center gap-1">
              <button type="button" onClick={resetSize} title="Reset to default size"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground dark:hover:text-gray-200 hover:bg-accent">
                <RotateCcw size={15} />
              </button>
              <button type="button" onClick={fitToScreen} title="Fill the screen"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground dark:hover:text-gray-200 hover:bg-accent">
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-4">
          {children({ width: size.width, height: size.height, bucket, chartHeight })}
        </div>

        {/* Drag grip. The three stacked bars are the conventional resize
            affordance; the whole 20px corner is the hit target. */}
        <div
          onPointerDown={startDrag}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-0.5 touch-none"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" className="text-muted-foreground">
            <path d="M11 3 3 11M11 7l-4 4M11 11h-.01" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Column count for a stat-tile row at each size - shared so the four
    widgets don't drift apart on how many tiles sit in a row. */
export function statCols(bucket: SizeBucket, max = 3): string {
  if (bucket === 'sm') return 'grid-cols-1';
  if (bucket === 'md') return max >= 3 ? 'grid-cols-3' : 'grid-cols-2';
  return max >= 4 ? 'grid-cols-4' : `grid-cols-${max}`;
}
