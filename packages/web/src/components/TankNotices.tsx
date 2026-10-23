// Small failure chips in the tank (picks unavailable, visitor fetches failing): visible, never silent.
import { useEffect, useState } from 'react';
import type { TankNotice } from '../lib/tankNotices';

export type { TankNotice } from '../lib/tankNotices';

const nowSec = () => Math.floor(Date.now() / 1000);

/** Unix seconds, ticking once a minute only while `on` (a chip age is showing); no per-frame state. */
export function useMinuteClock(on: boolean): number {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    if (!on) return;
    setNow(nowSec());
    const id = setInterval(() => setNow(nowSec()), 60_000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

// Only a chip with a tooltip takes the pointer, so hovering it can show the error; it never feeds.
export function TankNoticeChip({ notice }: { notice: TankNotice }) {
  return (
    <div
      role="status"
      data-reef-nofeed
      title={notice.title}
      className={`rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white/90 shadow ${notice.title ? 'pointer-events-auto cursor-help' : 'pointer-events-none'}`}
    >
      <span aria-hidden="true">⚠ </span>{notice.text}
      {notice.age && <span aria-hidden="true"> · {notice.age}</span>}
      {/* The tooltip's error message, for screen readers that never hover. */}
      {notice.title && <span className="sr-only">: {notice.title}</span>}
    </div>
  );
}
