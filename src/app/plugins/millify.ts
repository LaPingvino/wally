/**
 * Lightweight number formatter — replaces the millify library which called
 * toLocaleString() on every render, consuming ~13% of CPU in profiling.
 * For unread badges that re-render on every sync event, this is critical.
 */
export const millify = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    const k = count / 1000;
    return k < 10 ? `${k.toFixed(1)}K` : `${Math.round(k)}K`;
  }
  const m = count / 1_000_000;
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
};
