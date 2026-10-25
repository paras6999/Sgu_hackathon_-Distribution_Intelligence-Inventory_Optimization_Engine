/** Maps a value in [domainMin, domainMax] to a position in [rangeMin, rangeMax]. A flat domain maps to the middle. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const span = domainMax - domainMin;
  if (span === 0) return () => (rangeMin + rangeMax) / 2;
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** A "nice" number near `range`: a round 1, 2, 5 or 10 times a power of ten. */
function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (round) {
    nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return nice * 10 ** exponent;
}

/** Round tick values that cover [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (lo === hi) return [lo];
  const range = niceNumber(hi - lo, false);
  const step = niceNumber(range / Math.max(count - 1, 1), true);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const steps = Math.round((end - start) / step);
  const ticks: number[] = [];
  for (let i = 0; i <= steps; i++) {
    ticks.push(Number((start + i * step).toFixed(decimals)));
  }
  return ticks;
}

/** Turns points into the `points` attribute of an SVG polyline. */
export function polylinePoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
