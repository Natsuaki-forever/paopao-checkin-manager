import { useCallback, useEffect, useRef, useState } from "react";

export function useEasterEggSequence({
  clicks,
  windowMs,
  visibleMs = 2_600,
  enabled = true,
}: {
  clicks: number;
  windowMs: number;
  visibleMs?: number;
  enabled?: boolean;
}) {
  const sequence = useRef<number[]>([]);
  const hideTimer = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);

  const trigger = useCallback(() => {
    if (!enabled) return;
    const current = Date.now();
    sequence.current = [...sequence.current.filter((time) => current - time <= windowMs), current];
    if (sequence.current.length < clicks) return;
    sequence.current = [];
    setVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), visibleMs);
  }, [clicks, enabled, visibleMs, windowMs]);

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);

  return { visible, trigger };
}
