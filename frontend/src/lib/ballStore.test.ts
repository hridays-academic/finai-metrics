import { describe, expect, it, vi } from "vitest";
import { ballStore } from "./ballStore";

describe("ballStore", () => {
  it("frees the ball with a launch, then docks it back on the slider", () => {
    const seen = vi.fn();
    const stop = ballStore.subscribe(seen);
    expect(ballStore.mode()).toBe("hero");
    ballStore.free({ x: 10, y: 20, vx: 1, vy: 2 });
    expect(ballStore.mode()).toBe("free");
    expect(ballStore.launch()).toMatchObject({ x: 10, y: 20 });
    ballStore.dock({ x: 5, y: 6, vx: 0, vy: 300 });
    expect(ballStore.mode()).toBe("hero");
    expect(ballStore.launch()).toBeNull();
    expect(ballStore.dockAt()).toMatchObject({ x: 5, vy: 300 });
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });

  it("docking an already-docked ball does nothing", () => {
    const seen = vi.fn();
    const stop = ballStore.subscribe(seen);
    ballStore.dock();
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});
