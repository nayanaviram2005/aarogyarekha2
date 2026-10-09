import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { changeWord, sparkPoints } from '../lib/sparkline';
import type { Api, LabTrend, LabTrends } from '../lib/types';
import { LabTrendsPanel } from './LabTrendsPanel';
import { RecordContextPanel } from './RecordContextPanel';

const pt = (value: number | null, verified = true, at = '2026-09-01T00:00:00Z') => ({ at, value, text: value === null ? null : String(value), flag: null, verified, documentId: 'd', encounterId: 'e' });
const hb: LabTrend = { name: 'haemoglobin', label: 'Haemoglobin', unit: 'g/dL', unitsDiffer: false, change: { from: 9.1, to: 10.4, direction: 'up', unit: 'g/dL' }, points: [pt(9.1, true, '2026-07-01T00:00:00Z'), pt(10.4, false, '2026-10-01T00:00:00Z')] };
const api = (d: LabTrends | Error) => ({ labTrends: vi.fn(() => (d instanceof Error ? Promise.reject(d) : Promise.resolve(d))) }) as unknown as Api;

describe('sparkline maths', () => {
  it('spreads points across the width, with the highest value at the top', () => {
    const p = sparkPoints([1, 3, 2], 100, 40, 4);
    expect(p.map(x => x.x)).toEqual([4, 50, 96]); expect(p[1]!.y).toBe(4); expect(p[0]!.y).toBe(36);
  });
  it('puts a flat series in the middle, and a single value in the centre', () => {
    expect(sparkPoints([5, 5], 100, 40).every(p => p.y === 20)).toBe(true);
    expect(sparkPoints([5], 100, 40)[0]).toEqual({ x: 50, y: 20 });
    expect(sparkPoints([], 100, 40)).toEqual([]);
  });
  it('uses neutral words for a change', () => { expect([changeWord('up'), changeWord('down'), changeWord('same')]).toEqual(['Higher', 'Lower', 'Unchanged']); });
});

describe('results over time panel', () => {
  it('shows each test that has two or more numbers, with the values, a neutral change word and which dots are unchecked', async () => {
    render(<LabTrendsPanel api={api({ tests: [hb, { ...hb, name: 'esr', label: 'Esr', points: [pt(30)], change: null }], rows: 3, unverified: 1, visits: 2 })} patientId="p1" />);
    expect(await screen.findByText('Haemoglobin')).toBeInTheDocument();
    expect(screen.getByText(/9\.1 → 10\.4 g\/dL/)).toBeInTheDocument();
    expect(screen.getByText(/Higher than the one before/)).toBeInTheDocument();
    expect(screen.getByText(/hollow dots are not yet checked/)).toBeInTheDocument();
    expect(screen.queryByText('Esr')).toBeNull();
    expect(screen.getByRole('img', { name: /Haemoglobin: 9\.1, then 10\.4 g\/dL/ })).toBeInTheDocument();
    expect(screen.getByText(/does not say whether a change is good or bad/)).toBeInTheDocument();
  });
  it('says the units differ instead of comparing', async () => {
    render(<LabTrendsPanel api={api({ tests: [{ ...hb, change: null, unitsDiffer: true }], rows: 2, unverified: 0, visits: 2 })} patientId="p1" />);
    expect(await screen.findByText(/units differ between reports/)).toBeInTheDocument();
  });
  it('shows nothing when there is nothing to compare, or when it cannot load', async () => {
    const { container, rerender } = render(<LabTrendsPanel api={api({ tests: [], rows: 0, unverified: 0, visits: 0 })} patientId="p1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    rerender(<LabTrendsPanel api={api(new Error('x'))} patientId="p2" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('record gaps', () => {
  it('lists what the records cannot tell you yet', async () => {
    const ctx = { summary: { documents: 2, read: 1, notRead: 1, rows: 3, verified: 3, flagged: 0, lines: [], gaps: [{ code: 'unread' as const, text: 'No results could be read from x.jpg. Open it and check by eye, or upload a clearer copy.' }] }, documents: [] };
    render(<RecordContextPanel api={{ recordContext: vi.fn().mockResolvedValue(ctx) } as unknown as Api} encounterId="e1" />);
    expect(await screen.findByRole('group', { name: 'What the records cannot tell you yet' })).toHaveTextContent('x.jpg');
  });
});
