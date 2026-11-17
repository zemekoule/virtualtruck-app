const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.785;
const UNITS = {
	ats: {distance: 'mil', distanceTitle: 'Mil', speed: 'mph', volume: 'gal', currency: '$', km: 1 / KM_PER_MILE, litre: 1 / LITRES_PER_GALLON},
	eut2: {distance: 'km', distanceTitle: 'Km', speed: 'km/h', volume: 'l', currency: '€', km: 1, litre: 1},
}[DATA.game];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = n => Math.round(n).toLocaleString('cs-CZ');
const dist = km => fmt(km * UNITS.km);
const speed = kmh => fmt(kmh * UNITS.km);
const company = c => DATA.names.companies[c] ?? c;
const city = c => DATA.names.cities[c] ?? c;
const cargo = c => DATA.names.cargo[c] ?? c;
const truck = c => c ? DATA.names.trucks[c] ?? c : '';
const clock = t => `${String(Math.floor(t % 1440 / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const gameTime = t => `den ${Math.floor(t / 1440) + 1}, ${clock(t)}`;
const gameRange = (from, to) => Math.floor(from / 1440) === Math.floor(to / 1440) ? `${gameTime(from)} – ${clock(to)}` : `${gameTime(from)} – ${gameTime(to)}`;
const wallTime = (s, year = true) => {
	const d = new Date(s * 1000);
	return `${d.getDate()}.${d.getMonth() + 1}${year ? `.${d.getFullYear()}` : ''} ${d.toLocaleTimeString('cs-CZ')}`;
};
const minutes = m => m == null ? 'nehlášeno' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;

function statsHtml(stats) {
	return stats.map(([label, value]) => `<div class="stat"><span class="muted">${label}</span><b>${value}</b></div>`).join('');
}

const UNFINISHED = ['running', 'suspended'];
// Cancelling an external (WoT) job sends no SDK event, so it is marked by hand on the page.
const canCancelByHand = j => j.telemetry?.market?.startsWith('external_') && UNFINISHED.includes(j.status);
const setCancelledByHand = (id, cancelled) => cancelled
	? supabase('cancellations', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({game: DATA.game, job_id: id})})
	: supabase(`cancellations?game=eq.${DATA.game}&job_id=eq.${encodeURIComponent(id)}`, {method: 'DELETE'});
for (const id of DATA.cancellations) {
	const j = DATA.jobs.find(j => j.id === id);
	if (j && canCancelByHand(j)) {
		j.status = 'cancelled';
		j.cancelled_by_hand = true;
	}
}
