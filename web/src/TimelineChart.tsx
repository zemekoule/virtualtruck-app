import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { clock, type Format, gameRange, minutes } from './format';
import { isBad } from './jobText';
import type { TimelineEntry } from './types';

type SegmentKind = 'empty' | 'drive' | 'load' | 'rest' | 'suspended' | 'ferry' | 'train' | 'wait';
const SEGMENTS: Record<SegmentKind, string> = { empty: 'bez nákladu', drive: 's nákladem', load: 'nakládka', rest: 'přestávka', suspended: 'pozastaveno', ferry: 'trajekt', train: 'vlak', wait: 'čekání na odjezd' };
const BUS_SEGMENTS: Partial<Record<SegmentKind, string>> = { empty: 'bez cestujících', drive: 's cestujícími' };
const SEGMENT_ICONS: Partial<Record<SegmentKind, string>> = { rest: '☾ ', ferry: '⛴ ', train: '🚆 ' };
const ICONS: Partial<Record<TimelineEntry['type'], ReactNode>> = {
	start: <path d="M-3 -5 L5 0 L-3 5 Z" />,
	trailer: <><path className="line" d="M-6 -3 h8 v6 h-8 z M2 1 h4" /><circle cx="-3" cy="4.5" r="1.5" /></>,
	loaded: <path className="line" d="M-5 -1 L0 -4 L5 -1 V5 H-5 Z M-5 -1 L0 2 L5 -1 M0 2 V5" />,
	incident: <path d="M0 -5 L5.5 4.5 H-5.5 Z" />,
	damage: <path d="M-1 -6 L3 -1 L0 0 L2 6 L-3 0 L0 -1 Z" />,
	suspended: <path d="M-4 -5 h3 v10 h-3 z M1 -5 h3 v10 h-3 z" />,
	delivered: <path className="line" d="M-4 6 V-6 h8 l-2 3 l2 3 h-8" />,
	cancelled: <path className="line" d="M-4 -4 L4 4 M4 -4 L-4 4" />,
	departure: <path d="M-3 -5 L5 0 L-3 5 Z" />,
	arrival: <circle r="4" />,
};
// Approximate width of a 12px label character.
const LABEL_CHAR = 6.6;

function segments(entries: TimelineEntry[]) {
	const first = entries[0], last = entries[entries.length - 1];
	const loadedAt = (entries.find(e => e.type === 'loaded') ?? entries.find(e => e.type === 'trailer') ?? entries.find(e => e.type === 'departure'))?.game_time ?? first.game_time!;
	const result: { kind: SegmentKind; from: number; to: number }[] = [];
	const drive = (from: number, to: number) => {
		if (from < loadedAt) result.push({ kind: 'empty', from, to: Math.min(to, loadedAt) });
		if (to > loadedAt) result.push({ kind: 'drive', from: Math.max(from, loadedAt), to });
	};
	const STOPS: Record<string, SegmentKind> = { break: 'rest', loaded: 'load', suspended: 'suspended', wait: 'wait', 'player.use.ferry': 'ferry', 'player.use.train': 'train' };
	const stop = (e: TimelineEntry) => STOPS[e.type === 'incident' ? e.id! : e.type];
	let cursor = first.game_time!;
	for (const e of entries.filter(e => stop(e) && e.minutes)) {
		drive(cursor, e.game_time!);
		result.push({ kind: stop(e), from: e.game_time!, to: e.game_time! + e.minutes! });
		cursor = e.game_time! + e.minutes!;
	}
	drive(cursor, last.game_time!);
	return result.filter(g => g.to > g.from);
}

function eventLabel(e: TimelineEntry, f: Format) {
	const labels: Record<string, string> = {
		start: 'Převzetí', trailer: 'Návěs připojen', loaded: 'Naloženo', damage: 'Poškození', suspended: 'Zakázka pozastavena', delivered: 'Doručení', cancelled: 'Zrušení',
		'player.tollgate.paid': 'Mýtné', 'player.use.ferry': 'Trajekt', 'player.use.train': 'Vlak',
	};
	if (e.type === 'departure' || e.type === 'arrival') return `${e.type === 'departure' ? 'Odjezd' : 'Příjezd'} ${e.stop ?? ''}${e.late ? ` pozdě o ${minutes(e.late)}` : ''}`;
	const label = e.id === 'player.fined' ? `Pokuta ${f.money(Number(e.attrs!['fine.amount']))}` : labels[e.type === 'incident' ? e.id! : e.type] ?? e.id;
	return label + (e.late ? ` po termínu ${minutes(e.late)}` : '');
}

// The job as a bar over game time with an hour axis below and labelled events above.
export function TimelineChart({ entries, f }: { entries: TimelineEntry[]; f: Format }) {
	const ref = useRef<HTMLDivElement>(null);
	const [W, setW] = useState(0);
	const id = useId();
	useEffect(() => {
		const observer = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
		observer.observe(ref.current!);
		return () => observer.disconnect();
	}, []);

	const first = entries[0], last = entries[entries.length - 1];
	const bus = entries.some(e => e.type === 'departure');
	const segmentLabel = (kind: SegmentKind) => (bus && BUS_SEGMENTS[kind]) || SEGMENTS[kind];
	const valid = !entries.some(e => e.game_time == null) && last.game_time! > first.game_time!;
	let svg: ReactNode = null, height = 0;
	if (valid && W) {
		const span = last.game_time! - first.game_time!;
		const x = (t: number) => (t - first.game_time!) / span * W;
		// Labels go to the lowest row where they do not overlap a label already placed.
		const rowEnds: number[] = [];
		const labels = entries.filter(e => ICONS[e.type]).map(e => {
			const text = `${eventLabel(e, f)} · ${clock(e.game_time!)}`;
			const width = text.length * LABEL_CHAR + 22;
			const left = Math.min(Math.max(x(e.game_time!) - 6, 0), W - width);
			let row = rowEnds.findIndex(end => end + 10 <= left);
			if (row < 0) row = rowEnds.length;
			rowEnds[row] = left + width;
			return { e, text, left, row };
		});
		const ROW = 22, BAR = 28, barY = rowEnds.length * ROW + 8, axisY = barY + BAR;
		height = axisY + 26;
		const step = [30, 60, 120, 180, 360].find(m => W / (span / m) >= 60) ?? 720;
		const ticks: number[] = [];
		for (let t = Math.ceil(first.game_time! / step) * step; t <= last.game_time!; t += step) ticks.push(t);
		svg = (
			<svg width={W} height={height}>
				<defs>
					<pattern id={`${id}-rest`} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="10" height="10" className="rest-bg" /><rect width="4" height="10" className="rest-fg" /></pattern>
					<clipPath id={`${id}-clip`}><rect y={barY} width={W} height={BAR} rx="8" /></clipPath>
				</defs>
				<g clipPath={`url(#${id}-clip)`}>
					{segments(entries).map(g => {
						const x0 = x(g.from), w = x(g.to) - x0;
						const full = `${SEGMENT_ICONS[g.kind] ?? ''}${segmentLabel(g.kind)} ${minutes(g.to - g.from)}`, short = minutes(g.to - g.from);
						const text = w > full.length * 6.4 + 16 ? full : w > short.length * 6.4 + 12 ? short : '';
						return (
							<g key={g.from}>
								<rect className={`seg ${g.kind}`} x={x0} y={barY} width={w} height={BAR} fill={g.kind === 'rest' ? `url(#${id}-rest)` : undefined}>
									<title>{`${segmentLabel(g.kind)}: ${minutes(g.to - g.from)}, ${gameRange(g.from, g.to)}`}</title>
								</rect>
								{text && <text className={`seg-text ${g.kind}`} x={x0 + 8} y={barY + 18}>{text}</text>}
							</g>
						);
					})}
				</g>
				{ticks.map(t => {
					const midnight = t % 1440 === 0;
					return (
						<g key={t}>
							<line className={`tick${midnight ? ' day' : ''}`} x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + (midnight ? 10 : 5)} />
							<text className={`tick-text${midnight ? ' day' : ''}`} x={x(t)} y={axisY + 21} textAnchor={x(t) < 30 ? 'start' : x(t) > W - 30 ? 'end' : 'middle'}>{midnight ? `den ${t / 1440 + 1}` : clock(t)}</text>
						</g>
					);
				})}
				{labels.map(({ e, text, left, row }) => {
					const ex = x(e.game_time!), y = row * ROW + 10, bad = isBad(e) ? ' bad' : '';
					return (
						<g key={`${e.wall}-${e.type}-${e.id ?? ''}`}>
							<line className={`event-line${bad}`} x1={ex} y1={y + 7} x2={ex} y2={barY + BAR} />
							<g className={`event${bad}`} transform={`translate(${left + 8} ${y})`}>{ICONS[e.type]}</g>
							<text className={`event-text${bad}`} x={left + 20} y={y + 4}>{text}</text>
						</g>
					);
				})}
			</svg>
		);
	}
	return <div ref={ref} className="tl" style={{ height: height || undefined }}>{svg}</div>;
}
