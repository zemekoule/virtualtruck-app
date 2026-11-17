const SEGMENTS = {empty: 'bez nákladu', drive: 's nákladem', load: 'nakládka', rest: 'přestávka', suspended: 'pozastaveno', ferry: 'trajekt', train: 'vlak'};
const TL_ICONS = {
	start: '<path d="M-3 -5 L5 0 L-3 5 Z"/>',
	trailer: '<path class="line" d="M-6 -3 h8 v6 h-8 z M2 1 h4"/><circle cx="-3" cy="4.5" r="1.5"/>',
	loaded: '<path class="line" d="M-5 -1 L0 -4 L5 -1 V5 H-5 Z M-5 -1 L0 2 L5 -1 M0 2 V5"/>',
	incident: '<path d="M0 -5 L5.5 4.5 H-5.5 Z"/>',
	damage: '<path d="M-1 -6 L3 -1 L0 0 L2 6 L-3 0 L0 -1 Z"/>',
	suspended: '<path d="M-4 -5 h3 v10 h-3 z M1 -5 h3 v10 h-3 z"/>',
	delivered: '<path class="line" d="M-4 6 V-6 h8 l-2 3 l2 3 h-8"/>',
	cancelled: '<path class="line" d="M-4 -4 L4 4 M4 -4 L-4 4"/>',
};
const TL_LABEL_CHAR = 6.6;  // approximate width of a 12px label character

function timelineSegments(entries) {
	const first = entries[0], last = entries[entries.length - 1];
	const loadedAt = (entries.find(e => e.type === 'loaded') ?? entries.find(e => e.type === 'trailer'))?.game_time ?? first.game_time;
	const segments = [];
	const drive = (from, to) => {
		if (from < loadedAt) segments.push({kind: 'empty', from, to: Math.min(to, loadedAt)});
		if (to > loadedAt) segments.push({kind: 'drive', from: Math.max(from, loadedAt), to});
	};
	let cursor = first.game_time;
	const STOPS = {break: 'rest', loaded: 'load', suspended: 'suspended', 'player.use.ferry': 'ferry', 'player.use.train': 'train'};
	const stop = e => STOPS[e.type === 'incident' ? e.id : e.type];
	for (const e of entries.filter(e => stop(e) && e.minutes)) {
		drive(cursor, e.game_time);
		segments.push({kind: stop(e), from: e.game_time, to: e.game_time + e.minutes});
		cursor = e.game_time + e.minutes;
	}
	drive(cursor, last.game_time);
	return segments.filter(g => g.to > g.from);
}

const TL_LABELS = {
	start: 'Převzetí', trailer: 'Návěs připojen', loaded: 'Naloženo', damage: 'Poškození', suspended: 'Zakázka pozastavena', delivered: 'Doručení', cancelled: 'Zrušení',
	'player.fined': e => `Pokuta ${fmt(e.attrs['fine.amount'])} ${UNITS.currency}`, 'player.tollgate.paid': 'Mýtné', 'player.use.ferry': 'Trajekt', 'player.use.train': 'Vlak',
};

function timelineEventLabel(e) {
	const label = TL_LABELS[e.type === 'incident' ? e.id : e.type] ?? e.id;
	return (typeof label === 'function' ? label(e) : label) + (e.late ? ` po termínu ${minutes(e.late)}` : '');
}

// The job as a bar over game time with an hour axis below and labelled events above; drawn at the real width of the element.
function timelineChart(el, entries) {
	const first = entries[0], last = entries[entries.length - 1];
	if (entries.some(e => e.game_time == null) || last.game_time <= first.game_time) return;
	const segments = timelineSegments(entries);
	const events = entries.filter(e => TL_ICONS[e.type]);
	const span = last.game_time - first.game_time;
	const id = `tl-${first.wall}`;

	function draw() {
		const W = el.clientWidth;
		if (!W) return;
		const x = t => (t - first.game_time) / span * W;
		// Labels go to the lowest row where they do not overlap a label already placed.
		const rowEnds = [];
		const labels = events.map(e => {
			const text = `${timelineEventLabel(e)} · ${clock(e.game_time)}`;
			const width = text.length * TL_LABEL_CHAR + 22;
			const left = Math.min(Math.max(x(e.game_time) - 6, 0), W - width);
			let row = rowEnds.findIndex(end => end + 10 <= left);
			if (row < 0) row = rowEnds.length;
			rowEnds[row] = left + width;
			return {e, text, left, row};
		});
		const ROW = 22, BAR = 30, barY = rowEnds.length * ROW + 8, axisY = barY + BAR;
		let svg = `<defs><pattern id="${id}-rest" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="10" height="10" class="rest-bg"/><rect width="4" height="10" class="rest-fg"/></pattern><clipPath id="${id}-clip"><rect y="${barY}" width="${W}" height="${BAR}" rx="8"/></clipPath></defs>`;
		svg += `<g clip-path="url(#${id}-clip)">`;
		for (const g of segments) {
			const x0 = x(g.from), w = x(g.to) - x0;
			svg += `<rect class="seg ${g.kind}" x="${x0}" y="${barY}" width="${w}" height="${BAR}" ${g.kind === 'rest' ? `fill="url(#${id}-rest)"` : ''}><title>${SEGMENTS[g.kind]}: ${minutes(g.to - g.from)}, ${gameRange(g.from, g.to)}</title></rect>`;
			const full = `${{rest: '☾ ', ferry: '⛴ ', train: '🚆 '}[g.kind] ?? ''}${SEGMENTS[g.kind]} ${minutes(g.to - g.from)}`, short = minutes(g.to - g.from);
			const text = w > full.length * 6.4 + 16 ? full : w > short.length * 6.4 + 12 ? short : '';
			if (text) svg += `<text class="seg-text ${g.kind}" x="${x0 + 8}" y="${barY + 19}">${text}</text>`;
		}
		svg += '</g>';
		const step = [30, 60, 120, 180, 360].find(m => W / (span / m) >= 60) ?? 720;
		for (let t = Math.ceil(first.game_time / step) * step; t <= last.game_time; t += step) {
			const midnight = t % 1440 === 0;
			svg += `<line class="tick${midnight ? ' day' : ''}" x1="${x(t)}" y1="${axisY}" x2="${x(t)}" y2="${axisY + (midnight ? 10 : 5)}"/>`;
			svg += `<text class="tick-text${midnight ? ' day' : ''}" x="${x(t)}" y="${axisY + 21}" text-anchor="${x(t) < 30 ? 'start' : x(t) > W - 30 ? 'end' : 'middle'}">${midnight ? `den ${t / 1440 + 1}` : clock(t)}</text>`;
		}
		for (const {e, text, left, row} of labels) {
			const ex = x(e.game_time), y = row * ROW + 10, bad = e.id === 'player.fined' || e.type === 'damage' || e.late ? ' bad' : '';
			svg += `<line class="event-line${bad}" x1="${ex}" y1="${y + 7}" x2="${ex}" y2="${barY + BAR}"/>`;
			svg += `<g class="event${bad}" transform="translate(${left + 8} ${y})">${TL_ICONS[e.type]}</g>`;
			svg += `<text class="event-text${bad}" x="${left + 20}" y="${y + 4}">${esc(text)}</text>`;
		}
		el.innerHTML = `<svg width="${W}" height="${axisY + 28}">${svg}</svg>`;
	}
	new ResizeObserver(draw).observe(el);
}
