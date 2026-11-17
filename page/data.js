// Loads DATA (in the shape build.py writes to data-<game>.js) from Supabase, then the page scripts listed in data-scripts.
const PAGE = document.currentScript.dataset;
const SUPABASE_URL = `https://${SUPABASE.project_id}.supabase.co/rest/v1/`;
const PAGE_ROWS = 1000;

async function supabase(path, options = {}) {
	const response = await fetch(SUPABASE_URL + path, {...options, headers: {apikey: SUPABASE.publishable_key, 'Content-Type': 'application/json', ...options.headers}});
	const text = await response.text();
	if (!response.ok) throw new Error(`${response.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

async function selectAll(path) {
	// The Data API returns at most 1000 rows per request.
	const rows = [];
	for (;;) {
		const page = await supabase(`${path}&limit=${PAGE_ROWS}&offset=${rows.length}`);
		rows.push(...page);
		if (page.length < PAGE_ROWS) return rows;
	}
}

async function loadData(game) {
	const [jobs, depots, names, cancellations] = await Promise.all([
		selectAll(`jobs?game=eq.${game}&select=*&order=game_time.desc,id`),
		selectAll(`depots?game=eq.${game}&select=city,company&order=city,company`),
		selectAll(`names?game=eq.${game}&select=kind,id,name&order=kind,id`),
		selectAll(`cancellations?game=eq.${game}&select=job_id&order=job_id`),
	]);
	const data = {
		game,
		jobs: jobs.map(({game, source, ...job}) => job),
		depots: {},
		names: {companies: {}, cities: {}, cargo: {}, trucks: {}},
		cancellations: cancellations.map(c => c.job_id),
	};
	for (const d of depots) (data.depots[d.city] ??= []).push(d.company);
	for (const n of names) data.names[n.kind][n.id] = n.name;
	return data;
}

loadData(PAGE.game).then(data => {
	window.DATA = data;
	for (const src of PAGE.scripts.split(' ')) {
		const script = document.createElement('script');
		script.src = src;
		script.async = false;
		document.body.append(script);
	}
}, error => {
	const p = document.createElement('p');
	p.className = 'late';
	p.textContent = `Data ze Supabase se nenačetla: ${error.message}`;
	document.querySelector('main').append(p);
});
