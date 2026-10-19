import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Variable-height rows: never truncate customer text to obtain a fixed row size.
export function VirtualTimeline<T>({ items, itemKey, children, header }: {
  items: T[]; itemKey: (item: T) => string; children: (item: T) => ReactNode; header?: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [position, setPosition] = useState({ top: 0, height: 600 });
  const [, measure] = useState(0);
  let total = 0;
  const rows = items.map(item => { const key = itemKey(item); const top = total; total += heights.current.get(key) ?? 180; return { item, key, top, bottom: total }; });
  const visible = rows.filter(row => row.bottom >= position.top - 600 && row.top <= position.top + position.height + 600);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const keys = new Set(items.map(itemKey));
    for (const key of heights.current.keys()) if (!keys.has(key)) heights.current.delete(key);
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.rowKey;
        if (!key) continue;
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(key) !== height) { heights.current.set(key, height); changed = true; }
      }
      if (changed) measure(value => value + 1);
      setPosition(current => current.height === element.clientHeight ? current : { ...current, height: element.clientHeight });
    });
    observer.observe(element);
    element.querySelectorAll('[data-row-key]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  });
  return <div ref={viewport} className="max-h-[52vh] min-h-[260px] flex-1 overflow-auto p-3" aria-label="Timeline tin nhắn" onScroll={event => setPosition({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    {header}<div style={{ height: total, position: 'relative', overflowAnchor: 'none' }}>
      {visible.map(row => <div key={row.key} data-row-key={row.key} style={{ position: 'absolute', top: row.top, width: '100%', paddingBottom: 12 }}>{children(row.item)}</div>)}
    </div>
  </div>;
}