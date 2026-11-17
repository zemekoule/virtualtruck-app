const KIND = document.body.dataset.kind;

const OFFENCES = {
	crash: 'nehoda', avoid_sleeping: 'nedodržení odpočinku', wrong_way: 'jízda v protisměru',
	speeding_camera: 'překročení rychlosti (radar)', no_lights: 'jízda bez světel', red_signal: 'jízda na červenou',
	speeding: 'překročení rychlosti', avoid_weighing: 'vyhnutí se vážení', illegal_trailer: 'nepovolený návěs',
	avoid_inspection: 'vyhnutí se kontrole', illegal_border_crossing: 'nepovolený přejezd hranice',
	hard_shoulder_violation: 'jízda po krajnici', damaged_vehicle_usage: 'jízda s poškozeným vozidlem', generic: 'přestupek',
};

const MARKETS = {
	freight_market: ['interní', 'trh s náklady, návěs firmy'],
	cargo_market: ['interní', 'trh s nákladem, vlastní návěs'],
	quick_job: ['interní', 'rychlá zakázka'],
	external_contracts: ['externí (WoT)', 'kontrakty World of Trucks'],
	external_market: ['externí (WoT)', 'trh World of Trucks, vlastní návěs'],
};
const CAR_MARKETS = {quick_job: 'rychlá zakázka', dispatch_job: 'dispečink'};
const market = j => j.kind === 'car'
	? ['osobní doprava', CAR_MARKETS[j.telemetry.market] ?? j.telemetry.market ?? '—']
	: MARKETS[j.telemetry.market] ?? [j.telemetry.market ?? '—', j.telemetry.market ?? '—'];
const SATISFACTION = {cargo: 'náklad', time: 'čas', car: 'vzhled vozidla'};
const stars = rating => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

const jobs = DATA.jobs.filter(j => j.telemetry && j.kind === KIND);
const fines = j => j.telemetry.incidents.filter(i => i.id === 'player.fined').reduce((s, i) => s + i.attrs['fine.amount'], 0);

const delivered = jobs.filter(j => j.status === 'delivered');
document.getElementById('stats').innerHTML = statsHtml([
	['Zakázek', fmt(delivered.length)],
	[UNITS.distanceTitle, dist(delivered.reduce((s, j) => s + j.km, 0))],
	[`Výdělek ${UNITS.currency}`, fmt(delivered.reduce((s, j) => s + j.revenue, 0))],
	[`Pokuty ${UNITS.currency}`, fmt(jobs.reduce((s, j) => s + fines(j), 0))],
]);

function incidentRow(i) {
	const a = i.attrs;
	const route = [`${a['source.name']} → ${a['target.name']}`, i.minutes ? `${minutes(i.minutes)} herního času` : '', `${fmt(a['pay.amount'])} ${UNITS.currency}`].filter(Boolean).join(', ');
	switch (i.id) {
		case 'player.fined': return ['Pokuta', `${OFFENCES[a['fine.offence']] ?? a['fine.offence']}, ${fmt(a['fine.amount'])} ${UNITS.currency}`];
		case 'player.tollgate.paid': return ['Mýtné', `${fmt(a['pay.amount'])} ${UNITS.currency}`];
		case 'player.use.ferry': return ['Trajekt', route];
		case 'player.use.train': return ['Vlak', route];
		default: return [i.id, JSON.stringify(a)];
	}
}

const remaining = m => m != null && m < 0 ? `překročeno o ${minutes(-m)}` : minutes(m);
const rest = e => e.rest_stop == null ? ''
	: e.rest_stop === e.mandatory_break ? `do přestávky ${remaining(e.rest_stop)}`
	: `do odpočinku ${remaining(e.rest_stop)}, do povinné přestávky ${remaining(e.mandatory_break)}`;
const WEAR = {
	wear_engine: 'motor', wear_transmission: 'převodovka', wear_cabin: 'kabina', wear_chassis: 'podvozek', wear_wheels: 'kola',
	trailer_wear_body: 'návěs – nástavba', trailer_wear_chassis: 'návěs – podvozek', trailer_wear_wheels: 'návěs – kola',
};
const percent = v => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)} %`;
const damageText = fields => Object.entries(fields).map(([f, v]) => `${f === 'cargo_damage' ? 'náklad' : WEAR[f]} +${percent(v)}`).join(', ');
const wearText = (wear, trailer) => {
	const parts = Object.entries(wear).filter(([f, v]) => f.startsWith('trailer_') === trailer && v > 0);
	return parts.length ? parts.map(([f, v]) => `${WEAR[f].replace('návěs – ', '')} +${percent(v)}`).join(', ') : 'beze změny';
};
const trailerText = t => [[t.brand, t.name].filter(Boolean).join(' '), t['body.type'], t['license.plate']].filter(Boolean).join(', ');
// With a company trailer the game always reports auto.load.used; only with an own trailer it means a skipped loading.
const OWN_TRAILER_MARKETS = ['cargo_market', 'external_market'];
const APPROACH = {trailer: 'K návěsu', loading: 'K nakládce'};

function timelineRow(e) {
	switch (e.type) {
		case 'start': return ['Převzetí zakázky', esc(rest(e))];
		case 'trailer': return ['Návěs připojen', ''];
		case 'loaded': return ['Naloženo', e.minutes ? `nakládka ${minutes(e.minutes)} herního času` : ''];
		case 'damage': return ['Poškození', damageText(e.damage)];
		case 'break': return ['Přestávka', `${minutes(e.minutes)} herního času`];
		case 'suspended': return ['Zakázka pozastavena', e.minutes != null ? `${minutes(e.minutes)} herního času` : ''];
		case 'running': return ['Poslední záznam', esc(rest(e))];
		case 'incident': return incidentRow(e).map(esc);
		case 'delivered': return ['Doručení', esc([e.late ? `po termínu ${minutes(e.late)}` : '', rest(e)].filter(Boolean).join(', '))];
		case 'cancelled': return ['Zrušení', esc(rest(e))];
	}
}

function durationText(t) {
	const [first, last] = [t.timeline[0], t.timeline[t.timeline.length - 1]];
	const suspended = t.timeline.filter(e => e.type === 'suspended' && e.resumed_wall).reduce((sum, e) => sum + e.resumed_wall - e.wall, 0);
	const real = `skutečně ${minutes(Math.round((t.end - t.start - suspended) / 60))}`;
	if (first.game_time == null || last.game_time == null) return real;
	const total = last.game_time - first.game_time;
	const stops = t.timeline.filter(e => ['break', 'loaded', 'suspended', 'incident'].includes(e.type)).reduce((sum, e) => sum + (e.minutes ?? 0), 0);
	return stops
		? `${minutes(total - stops)} herního času bez přestávek, nakládky, pozastavení a přepravy (celkem ${minutes(total)}), ${real}`
		: `${minutes(total)} herního času, ${real}`;
}

function deadlineText(j) {
	const t = j.telemetry;
	if (t.deadline == null) return t.market?.startsWith('external_') ? 'v reálném čase (WoT), SDK ho neposílá' : '—';
	const late = t.timeline[t.timeline.length - 1].late;
	return `${gameTime(t.deadline)}${j.status !== 'delivered' ? '' : late ? `, <span class="late">doručeno po termínu ${minutes(late)}</span>` : ', doručeno včas'}`;
}

function timelineHtml(entries) {
	const gameDay = t => Math.floor(t / 1440);
	const wallDay = s => new Date(s * 1000).toDateString();
	let lastGameDay = null, lastWallDay = null;
	const gameTimes = (from, to) => {
		const text = `${gameDay(from) === lastGameDay ? clock(from) : gameTime(from)}${to > from ? ` – ${gameDay(to) === gameDay(from) ? clock(to) : gameTime(to)}` : ''}`;
		lastGameDay = gameDay(to);
		return text;
	};
	const loadedAt = (entries.find(e => e.type === 'loaded') ?? entries.find(e => e.type === 'trailer'))?.game_time;
	const rows = [];
	entries.forEach((e, i) => {
		const prev = entries[i - 1];
		// Driving since the previous entry ended (a break or loading ends after its minutes).
		const from = prev && prev.game_time != null ? prev.game_time + (prev.minutes ?? 0) : null;
		if (from != null && e.game_time != null && e.game_time - from >= 1) {
			const label = loadedAt == null || e.game_time > loadedAt ? 'Jízda' : 'Jízda bez nákladu';
			rows.push(`<tr class="muted"><td class="nowrap">${gameTimes(from, e.game_time)}</td><td></td><td class="num">${dist(e.km - prev.km)}</td><td class="nowrap">${label}</td><td>${minutes(e.game_time - from)}</td></tr>`);
		}
		const [label, text] = timelineRow(e);
		const gameCell = e.game_time == null ? '—' : gameTimes(e.game_time, e.game_time + (e.minutes ?? 0));
		const wallCell = wallDay(e.wall) === lastWallDay ? new Date(e.wall * 1000).toLocaleTimeString('cs-CZ') : wallTime(e.wall, i === 0);
		lastWallDay = wallDay(e.wall);
		rows.push(`<tr><td class="nowrap">${gameCell}</td><td class="nowrap">${wallCell}</td><td></td><td class="nowrap">${label}</td><td>${text}</td></tr>`);
	});
	return `<div class="tl"></div><table class="timeline"><thead><tr><th>Herní čas</th><th>Skutečný čas</th><th class="num">${UNITS.distance}</th><th>Událost</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function detailHtml(j) {
	const t = j.telemetry;
	const pct = v => v != null ? `${(v * 100).toFixed(1)} %` : '—';
	const rows = [
		['ID zakázky', esc(j.id)],
		['Typ zakázky', market(j).join(' – ')],
		['Doba jízdy', durationText(t)],
		['Termín', deadlineText(j)],
		['Poškození nákladu', pct(t.cargo_damage)],
	];
	if (j.kind === 'car') {
		const c = j.car;
		rows.push(
			['Poškození vozidla', pct(t.vehicle_damage)],
			...(c ? [
				['Hodnocení kurýra', stars(c.rating)],
				['Spokojenost zákazníka', Object.entries(SATISFACTION).map(([k, label]) => `${label} ${c.satisfaction[k]}`).join(', ')],
				['Priority zákazníka', Object.entries(SATISFACTION).filter(([k]) => c.priority[k]).map(([, label]) => label).join(', ') || 'žádné'],
				['Odměna', `předběžná ${fmt(c.provisional_reward)} ${UNITS.currency}, výsledná ${fmt(j.revenue)} ${UNITS.currency}`],
			] : [['Hodnocení', 'zatím jen z pluginu – hodnocení a spokojenost doplní save po uložení hry']]),
		);
	}
	else {
		rows.push(
			['Hmotnost', `${fmt(j.mass)} kg`],
			...(t.trailers?.length ? [['Návěs', t.trailers.map(trailerText).map(esc).join(' + ')]] : []),
			['Parkování', t.auto_park == null ? '—' : t.auto_park ? 'automatické (přeskočeno)' : 'ruční'],
			['Nakládka', t.auto_load == null ? '—' : !OWN_TRAILER_MARKETS.includes(t.market) ? 'návěs firmy, už naložený' : t.auto_load ? 'přeskočena' : 'ruční'],
		);
	}
	if (j.cancelled_by_hand) rows.push(['Zrušení', `ručně na stránce <button data-cancel="0" data-id="${esc(j.id)}">Vrátit</button>`]);
	else if (canCancelByHand(j)) rows.push(['Zrušení', `<button data-cancel="1" data-id="${esc(j.id)}">Zrušit zakázku</button> <span class="muted">SDK zrušení WoT zakázky nehlásí</span>`]);
	rows.push(['Vzdálenost', `plán ${t.planned_km != null ? dist(t.planned_km) : '—'} ${UNITS.distance}${j.km != null ? `, skutečně ${dist(j.km)} ${UNITS.distance}` : ''}`]);
	if (t.trace) {
		rows.push(
			['Ujeto podle tachometru', `${dist(t.trace.driven_km)} ${UNITS.distance} (od převzetí zakázky${j.kind === 'car' ? '' : ', včetně cesty bez nákladu'})`],
			...(t.trace.approach ? [
				[APPROACH[t.trace.approach.kind], `${dist(t.trace.approach.km)} ${UNITS.distance}, ${minutes(t.trace.approach.minutes)} herního času`],
				['S nákladem', `${dist(t.trace.driven_km - t.trace.approach.km)} ${UNITS.distance}`],
			] : []),
			['Rychlost', `max ${speed(t.trace.max_kmh)} ${UNITS.speed}, průměr v jízdě ${speed(t.trace.avg_kmh)} ${UNITS.speed}`],
			['Spotřeba', `${fmt(t.trace.fuel_used * UNITS.litre)} ${UNITS.volume}`],
			...(t.trace.wear ? [
				['Opotřebení kamionu', wearText(t.trace.wear, false)],
				...(j.kind === 'car' ? [] : [['Opotřebení návěsu', wearText(t.trace.wear, true)]]),
			] : []),
			['Nad limitem', t.trace.speeding_pct == null
				? 'limit nezaznamenán (plugin < 1.2.0 nebo ho hra neposílá)'
				: `${t.trace.speeding_pct === 0 && t.trace.max_over_kmh ? 'méně než 1' : t.trace.speeding_pct} % jízdy s limitem${t.trace.max_over_kmh ? `, nejvíc o ${speed(t.trace.max_over_kmh)} ${UNITS.speed}` : ''}`],
		);
	}
	return `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>${timelineHtml(t.timeline)}${t.trace?.path?.length > 1 ? '<canvas class="route-map"></canvas>' : ''}`;
}

const cityLink = c => `<a href="${DATA.game === 'eut2' ? 'mesta-ets2.html' : 'mesta.html'}?city=${encodeURIComponent(c)}">${esc(city(c))}</a>`;

const COLUMNS = [
	['Doručeno', 'nowrap', j => UNFINISHED.includes(j.status) ? '<span class="badge open">probíhá</span>' : wallTime(j.telemetry.end)],
	['Typ', 'nowrap', j => esc(market(j)[KIND === 'car' ? 1 : 0])],
	['Odkud', '', j => `${esc(company(j.src_company))}, ${cityLink(j.src_city)}`],
	['Kam', '', j => `${esc(company(j.dst_company))}, ${cityLink(j.dst_city)}`],
	['Náklad', '', j => esc(cargo(j.cargo))],
	[KIND === 'car' ? 'Auto' : 'Kamion', '', j => esc(truck(j.truck))],
	[UNITS.distance, 'num', j => j.km != null ? dist(j.km) : ''],
	['Výdělek', 'num', j => j.revenue != null ? fmt(j.revenue) : ''],
	KIND === 'car'
		? ['Hodnocení', 'nowrap', j => j.car ? stars(j.car.rating) : '']
		: ['XP', 'num', j => j.xp != null ? fmt(j.xp) : ''],
	['Pokuty', 'num', j => fines(j) ? fmt(fines(j)) : ''],
	['', '', j => j.status === 'cancelled' ? '<span class="badge">zrušena</span>' : ''],
];

document.getElementById('head').innerHTML = `<tr>${COLUMNS.map(([label, cls]) => `<th class="${cls}">${label}</th>`).join('')}</tr>`;
const tbody = document.getElementById('jobs');
tbody.innerHTML = jobs.length
	? jobs.map((j, i) => `<tr class="job" data-i="${i}">${COLUMNS.map(([, cls, cell]) => `<td class="${cls}">${cell(j)}</td>`).join('')}</tr>`).join('')
	: `<tr><td colspan="${COLUMNS.length}" class="muted">Zatím žádná jízda zaznamenaná pluginem.</td></tr>`;
tbody.addEventListener('click', e => {
	const button = e.target.closest('button[data-cancel]');
	if (button) {
		setCancelledByHand(button.dataset.id, button.dataset.cancel === '1').then(() => location.reload(), error => {
			button.insertAdjacentText('afterend', ` Nepovedlo se: ${error.message}`);
		});
		return;
	}
	const row = e.target.closest('tr.job');
	if (!row || e.target.closest('a')) return;
	if (row.nextElementSibling?.classList.contains('detail')) {
		row.nextElementSibling.remove();
		return;
	}
	row.insertAdjacentHTML('afterend', `<tr class="detail"><td colspan="${COLUMNS.length}">${detailHtml(jobs[row.dataset.i])}</td></tr>`);
	const job = jobs[row.dataset.i];
	const canvas = row.nextElementSibling.querySelector('canvas.route-map');
	if (canvas) mapView(canvas, job.telemetry.trace.path, job.telemetry.trace.approach?.path_index ?? 0);
	timelineChart(row.nextElementSibling.querySelector('.tl'), job.telemetry.timeline);
});
