// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEasterEggSequence } from "../src/web/hooks/useEasterEggSequence";

describe("useEasterEggSequence", () => {
  afterEach(() => vi.useRealTimers());

  it("opens after the configured click count and disappears", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEasterEggSequence({ clicks: 5, windowMs: 3_000, visibleMs: 2_000 }));
    act(() => { for (let index = 0; index < 5; index += 1) result.current.trigger(); });
    expect(result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(2_001));
    expect(result.current.visible).toBe(false);
  });

  it("resets clicks that fall outside the time window", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEasterEggSequence({ clicks: 3, windowMs: 1_000 }));
    act(() => { result.current.trigger(); result.current.trigger(); vi.advanceTimersByTime(1_001); result.current.trigger(); });
    expect(result.current.visible).toBe(false);
  });
});
