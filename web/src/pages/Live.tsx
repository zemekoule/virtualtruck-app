import { fromAtsCoordsToWgs84, fromEts2CoordsToWgs84 } from '@truckermudgeon/map/projections';
import type { FeatureCollection } from 'geojson';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/maplibre';
import { latestTracePoint } from '../api';
import { fmt, minutes, plural, useGame, wallClock } from '../format';
import { GameMap } from '../GameMap';
import type { GameId, TracePoint } from '../types';

// The plugin writes a trace point every 5 s and sync.py uploads it every 5 s.
const POLL_MS = 5000;
// Straight-line game units per game minute: 20th percentile of 3 h windows of our traces (2026-11-07), so most drives get at least this far.
const REACH_PER_MINUTE: Record<GameId, number> = { ats: 44, eut2: 32 };
const PADDING = { top: 60, right: 60, bottom: 60, left: 460 };

type Point = [number, number];

function circle([x, z]: Point, r: number): Point[] {
	return Array.from({ length: 65 }, (_, i) => [x + r * Math.cos(i / 32 * Math.PI), z + r * Math.sin(i / 32 * Math.PI)]);
}

function Refit({ request, points, toLonLat }: { request: number; points: Point[]; toLonLat: (p: Point) => Point }) {
	const { current: map } = useMap();
	useEffect(() => {
		if (!request || !map) return;
		const coords = points.map(toLonLat);
		const lons = coords.map(c => c[0]), lats = coords.map(c => c[1]);
		map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: PADDING, maxZoom: 12 });
	}, [request]); // New positions alone must not move the map away from where the user panned.
	return null;
}

export function Live() {
	const { data } = useGame();
	const game = data.game;
	const [point, setPoint] = useState<{ game: GameId; point: TracePoint | null }>();
	const [parking, setParking] = useState<{ game: GameId; places: Point[] }>();
	const [error, setError] = useState('');
	const [refit, setRefit] = useState(0);
	const toLonLat = game === 'ats' ? fromAtsCoordsToWgs84 : fromEts2CoordsToWgs84;

	useEffect(() => {
		fetch(`/tiles/parking-${game}.json`)
			.then(r => r.ok ? r.json() : Promise.reject(new Error(`parking-${game}.json: ${r.status}`)))
			.then((places: Point[]) => setParking({ game, places }), (e: Error) => setError(e.message));
	}, [game]);

	useEffect(() => {
		let active = true;
		const load = () => latestTracePoint(game).then(p => {
			if (!active) return;
			setPoint({ game, point: p });
			setError('');
		}, (e: Error) => active && setError(e.message));
		load();
		const id = setInterval(load, POLL_MS);
		return () => {
			active = false;
			clearInterval(id);
		};
	}, [game]);

	const p = point?.game === game ? point.point : undefined;
	const places = parking?.game === game ? parking.places : undefined;
	const reported = p ? [p.rest_stop, p.mandatory_break].filter(v => v != null) : [];
	const left = reported.length ? Math.min(...reported) : null;
	const radius = left != null && left > 0 ? left * REACH_PER_MINUTE[game] : 0;
	const tx = p?.x, tz = p?.z;
	const truck = useMemo<Point | null>(() => tx != null && tz != null ? [tx, tz] : null, [tx, tz]);
	const reachable = useMemo(
		() => truck && places ? places.filter(([x, z]) => Math.hypot(x - truck[0], z - truck[1]) <= radius) : [],
		[truck, places, radius],
	);
	const ring = useMemo(() => !truck ? [] : radius > 0 ? circle(truck, radius) : [truck], [truck, radius]);

	const features = useMemo<FeatureCollection>(() => ({
		type: 'FeatureCollection',
		features: [
			...(radius > 0 ? [{ type: 'Feature' as const, properties: { part: 'range' }, geometry: { type: 'Polygon' as const, coordinates: [ring.map(toLonLat)] } }] : []),
			...reachable.map(pl => ({ type: 'Feature' as const, properties: { part: 'parking' }, geometry: { type: 'Point' as const, coordinates: toLonLat(pl) } })),
			...(truck ? [{ type: 'Feature' as const, properties: { part: 'truck' }, geometry: { type: 'Point' as const, coordinates: toLonLat(truck) } }] : []),
		],
	}), [ring, reachable, truck, radius, toLonLat]);

	return (
		<div className="map-page">
			{truck && (
				<GameMap game={game} routes={[]} fitTo={ring} padding={PADDING}>
					<Source id="live" type="geojson" data={features}>
						<Layer id="live-range" type="fill" filter={['==', ['get', 'part'], 'range']} paint={{ 'fill-color': '#5fcf8f', 'fill-opacity': 0.06 }} />
						<Layer id="live-range-edge" type="line" filter={['==', ['get', 'part'], 'range']} paint={{ 'line-color': '#5fcf8f', 'line-width': 2, 'line-dasharray': [2, 1.6] }} />
						<Layer id="live-parking" type="circle" filter={['==', ['get', 'part'], 'parking']} paint={{ 'circle-radius': 9, 'circle-color': 'rgba(95, 207, 143, 0.25)', 'circle-stroke-color': '#5fcf8f', 'circle-stroke-width': 2.5 }} />
						<Layer id="live-truck" type="circle" filter={['==', ['get', 'part'], 'truck']} paint={{ 'circle-radius': 7, 'circle-color': '#f2a93b', 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 2.5 }} />
					</Source>
					<Refit request={refit} points={ring} toLonLat={toLonLat} />
				</GameMap>
			)}
			<aside className="panel compact">
				<h1>Parkoviště na přestávku</h1>
				{error && <p className="bad">Data se nenačetla: {error}</p>}
				{p === undefined ? <p className="muted">Načítám polohu…</p>
					: p === null ? <p className="muted">Plugin zatím nezapsal žádnou polohu.</p>
					: <>
						<div className="grid-stats two">
							<div><span>Do odpočinku</span><b>{minutes(p.rest_stop)}</b></div>
							<div><span>Do povinné přestávky</span><b>{minutes(p.mandatory_break)}</b></div>
						</div>
						<p>
							{left == null ? <span className="muted">Hra nehlásí čas do přestávky.</span>
								: radius > 0 ? <>V dosahu <b className="good">{fmt(reachable.length)} {plural(reachable.length, 'parkoviště', 'parkoviště', 'parkovišť')}</b>{places ? '' : ' (načítám seznam)'}.</>
								: <span className="bad">Přestávka už měla začít.</span>}
						</p>
						<p className="muted small">Kruh je vzdušnou čarou podle toho, kam jsem za stejný čas obvykle dojel; jestli na parkoviště vede cesta po trase, mapa nepočítá. Poloha z {wallClock(p.wall)}, obnovuje se každých {POLL_MS / 1000} s.</p>
						<button type="button" className="link-button" onClick={() => setRefit(r => r + 1)}>Zaměřit kamion</button>
					</>}
			</aside>
		</div>
	);
}
