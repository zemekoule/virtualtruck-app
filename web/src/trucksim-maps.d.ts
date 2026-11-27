// What we use from tools/trucksim-maps (resolved by the Vite aliases); tsc does not check its sources against our dependencies.

declare module '@truckermudgeon/map/projections' {
	export function fromAtsCoordsToWgs84(position: [number, number]): [number, number];
	export function fromEts2CoordsToWgs84(position: [number, number]): [number, number];
}

declare module '@truckermudgeon/ui/GameMapStyle' {
	import type { ReactNode } from 'react';
	export function GameMapStyle(props: { game: 'ats' | 'ets2'; tileRootUrl: string; mode?: 'light' | 'dark'; children?: ReactNode }): ReactNode;
}

declare module '@truckermudgeon/ui/BaseMapStyle' {
	import type { ReactNode } from 'react';
	export function BaseMapStyle(props: { tileRootUrl: string; mode?: 'light' | 'dark'; children?: ReactNode }): ReactNode;
}
