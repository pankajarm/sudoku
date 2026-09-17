// Account for the state that was active during an interval, including the final
// visible interval before a tab is hidden. The clock never reads wall time.
export function createClock(now = () => performance.now()) {
  let last = now(), running = false;
  return {
    update(nextRunning) {
      const current = now();
      const elapsed = running ? Math.max(0, current - last) : 0;
      last = current;
      running = Boolean(nextRunning);
      return elapsed;
    },
    reset() { last = now(); running = false; },
  };
}
