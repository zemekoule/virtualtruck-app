const delivered = DATA.jobs.filter(j => j.status === 'delivered');
const STATUS = {cancelled: 'zrušena', running: 'probíhá', suspended: 'probíhá'};

document.getElementById('source').textContent = 'Všechny zakázky ze savu a z pluginu (data ze Supabase).';
document.getElementById('stats').innerHTML = statsHtml([
	['Zakázek kamionem', fmt(delivered.filter(j => j.kind === 'truck').length)],
	...(DATA.game === 'ats' ? [['Zakázek osobní dopravy', fmt(delivered.filter(j => j.kind === 'car').length)]] : []),
	[UNITS.distanceTitle, dist(delivered.reduce((s, j) => s + j.km, 0))],
	[`Výdělek ${UNITS.currency}`, fmt(delivered.reduce((s, j) => s + j.revenue, 0))],
]);

const cityCodes = [...new Set([...DATA.jobs.flatMap(j => [j.src_city, j.dst_city]), ...Object.keys(DATA.depots)].filter(Boolean))].sort((a, b) => city(a).localeCompare(city(b)));
document.getElementById('cities').innerHTML = cityCodes.map(c => `<option value="${esc(city(c))}">${esc(c)}</option>`).join('');

function jobsTable(code) {
	const jobs = DATA.jobs.filter(j => j.src_city === code || j.dst_city === code);
	const place = (c, cityCode) => cityCode === code ? esc(company(c)) : `${esc(company(c))}, ${esc(city(cityCode))}`;
	return `<h2>Zakázky (${fmt(jobs.length)})</h2><div class="table-wrap"><table>
		<thead><tr><th>Herní čas</th><th>Odkud</th><th>Kam</th><th>Náklad</th><th class="num">${UNITS.distance}</th><th class="num">Výdělek</th><th></th></tr></thead>
		<tbody>${jobs.map(j => `<tr>
			<td class="nowrap">${j.game_time ? gameTime(j.game_time) : '—'}</td>
			<td>${place(j.src_company, j.src_city)}</td>
			<td>${place(j.dst_company, j.dst_city)}</td>
			<td>${esc(j.kind === 'car' ? 'osobní doprava' : cargo(j.cargo))}</td>
			<td class="num">${j.km != null ? dist(j.km) : ''}</td>
			<td class="num">${j.revenue != null ? fmt(j.revenue) : ''}</td>
			<td>${STATUS[j.status] ? `<span class="badge${j.status === 'cancelled' ? '' : ' open'}">${STATUS[j.status]}</span>` : ''}</td>
		</tr>`).join('')}</tbody>
	</table></div>`;
}

function show(q) {
	const code = cityCodes.find(c => c === q || city(c).toLowerCase() === q);
	const out = document.getElementById('city-result');
	if (!code) {
		out.innerHTML = q ? '<span class="muted">Takové město neznám.</span>' : '';
		return;
	}
	const depots = Object.fromEntries((DATA.depots[code] ?? []).map(c => [c, {from: 0, to: 0}]));
	for (const j of delivered) {
		if (j.src_city === code) (depots[j.src_company] ??= {from: 0, to: 0}).from++;
		if (j.dst_city === code) (depots[j.dst_company] ??= {from: 0, to: 0}).to++;
	}
	const rows = Object.entries(depots).sort((a, b) => (b[1].from + b[1].to) - (a[1].from + a[1].to) || company(a[0]).localeCompare(company(b[0])));
	const served = rows.filter(([, n]) => n.from + n.to).length;
	out.innerHTML = `<p>Vezl jsem z/do ${served} z ${rows.length} dep.</p><div class="table-wrap"><table>
		<thead><tr><th>Firma</th><th>Depo</th><th class="num">Odvoz z ní</th><th class="num">Doručení do ní</th></tr></thead>
		<tbody>${rows.map(([c, n]) => `<tr${n.from + n.to ? '' : ' class="muted"'}><td>${esc(company(c))}</td><td><code>${esc(c)}</code></td><td class="num">${n.from}</td><td class="num">${n.to}</td></tr>`).join('')}</tbody>
	</table></div>${jobsTable(code)}`;
}

const input = document.getElementById('city');
input.addEventListener('input', e => show(e.target.value.trim().toLowerCase()));
const linked = new URLSearchParams(location.search).get('city');
if (linked) {
	input.value = city(linked);
	show(linked);
}
