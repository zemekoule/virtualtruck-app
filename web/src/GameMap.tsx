import { fromAtsCoordsToWgs84, fromEts2CoordsToWgs84 } from '@truckermudgeon/map/projections';
import { GameMapStyle } from '@truckermudgeon/ui/GameMapStyle';
import type { FeatureCollection } from 'geojson';
import { setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { type ReactNode, useMemo, useRef } from 'react';
import MapGL, { Layer, type MapRef, NavigationControl, Source } from 'react-map-gl/maplibre';
import type { GameId } from './types';

const MAP_STYLE: StyleSpecification = {
	version: 8,
	glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
	// MapLibre needs an absolute sprite URL.
	sprite: `${window.location.origin}/tiles/sprites`,
	sources: {},
	// Land colour of the dark mode in tools/trucksim-maps (BaseMapStyle), without its real-world base map.
	layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1a1a1a' } }],
};

// MapLibre looks for its worker next to its own file, which Vite moves when it bundles the library.
setWorkerUrl(workerUrl);

const TILE_GAME = { ats: 'ats', eut2: 'ets2' } as const;

export type Route = {
	path: [number, number][];
	// Points before it are the drive without cargo, drawn dashed.
	splitIndex?: number;
};

// Game x/z coordinates of the trace over the game map tiles made by tools/trucksim-maps.
export function GameMap({ game, routes, fitTo, padding, children }: { game: GameId; routes: Route[]; fitTo: [number, number][]; padding?: { top: number; right: number; bottom: number; left: number }; children?: ReactNode }) {
	const mapRef = useRef<MapRef>(null);
	const toLonLat = game === 'ats' ? fromAtsCoordsToWgs84 : fromEts2CoordsToWgs84;

	const data = useMemo<FeatureCollection>(() => ({
		type: 'FeatureCollection',
		features: routes.flatMap(({ path, splitIndex = 0 }) => {
			const coords = path.map(p => toLonLat(p));
			return [
				{ type: 'Feature', properties: { part: 'empty' }, geometry: { type: 'LineString', coordinates: coords.slice(0, splitIndex + 1) } },
				{ type: 'Feature', properties: { part: 'loaded' }, geometry: { type: 'LineString', coordinates: coords.slice(splitIndex) } },
				{ type: 'Feature', properties: { part: 'start' }, geometry: { type: 'Point', coordinates: coords[0] } },
				{ type: 'Feature', properties: { part: 'end' }, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } },
			];
		}),
	}), [routes, toLonLat]);

	const bounds = useMemo(() => {
		const coords = fitTo.map(p => toLonLat(p));
		const lons = coords.map(c => c[0]), lats = coords.map(c => c[1]);
		return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number, number], [number, number]];
	}, [fitTo, toLonLat]);
	const fitPadding = padding ?? 60;

	return (
		<MapGL
			ref={mapRef}
			mapStyle={MAP_STYLE}
			attributionControl={false}
			initialViewState={{ bounds, fitBoundsOptions: { padding: fitPadding, maxZoom: 12 } }}
			style={{ position: 'absolute', inset: 0 }}
		>
			<GameMapStyle game={TILE_GAME[game]} tileRootUrl={`${window.location.origin}/tiles`} mode="dark" />
			<Source id="routes" type="geojson" data={data}>
				<Layer id="route-glow" type="line" filter={['==', ['get', 'part'], 'loaded']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#f2a93b', 'line-width': 12, 'line-opacity': 0.2 }} />
				<Layer id="route-empty" type="line" filter={['==', ['get', 'part'], 'empty']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#6aa8ff', 'line-width': 3.5, 'line-dasharray': [2, 1.6] }} />
				<Layer id="route-loaded" type="line" filter={['==', ['get', 'part'], 'loaded']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': '#f2a93b', 'line-width': 4 }} />
				<Layer id="route-start" type="circle" filter={['==', ['get', 'part'], 'start']} paint={{ 'circle-radius': 6, 'circle-color': '#0d1014', 'circle-stroke-color': '#e8eaed', 'circle-stroke-width': 2.5 }} />
				<Layer id="route-end" type="circle" filter={['==', ['get', 'part'], 'end']} paint={{ 'circle-radius': 7, 'circle-color': '#f2a93b', 'circle-stroke-color': '#0d1014', 'circle-stroke-width': 2.5 }} />
			</Source>
			{children}
			<NavigationControl position="top-right" showCompass={false} />
		</MapGL>
	);
}
