export interface SparkPoint { x: number; y: number }

export function sparkPoints(values: number[], width: number, height: number, pad = 4): SparkPoint[] {
  if (values.length === 0) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min;
  const w = width - pad * 2, h = height - pad * 2;
  return values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : pad + (w * i) / (values.length - 1),
    y: span === 0 ? height / 2 : pad + h - ((v - min) / span) * h,
  }));
}

export function changeWord(direction: 'up' | 'down' | 'same'): string {
  return direction === 'up' ? 'Higher' : direction === 'down' ? 'Lower' : 'Unchanged';
}
