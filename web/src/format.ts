import { createContext, useContext } from 'react';
import type { GameData, GameId } from './types';

const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.785;
const UNITS = {
	ats: { distance: 'mil', distanceTitle: 'Mil', speed: 'mph', volume: 'gal', consumption: 'mpg', km: 1 / KM_PER_MILE, litre: 1 / LITRES_PER_GALLON },
	eut2: { distance: 'km', distanceTitle: 'Km', speed: 'km/h', volume: 'l', consumption: 'l/100 km', km: 1, litre: 1 },
};
export const GAME_NAMES: Record<GameId, string> = { ats: 'American Truck Simulator', eut2: 'Euro Truck Simulator 2' };
export const GAME_SHORT: Record<GameId, string> = { ats: 'ATS', eut2: 'ETS2' };

export const fmt = (n: number) => Math.round(n).toLocaleString('cs-CZ');
export const clock = (t: number) => `${String(Math.floor(t % 1440 / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
export const gameTime = (t: number) => `den ${Math.floor(t / 1440) + 1}, ${clock(t)}`;
export const gameRange = (from: number, to: number) => Math.floor(from / 1440) === Math.floor(to / 1440) ? `${gameTime(from)} – ${clock(to)}` : `${gameTime(from)} – ${gameTime(to)}`;
export const wallTime = (s: number, year = true) => {
	const d = new Date(s * 1000);
	return `${d.getDate()}. ${d.getMonth() + 1}.${year ? ` ${d.getFullYear()}` : ''} ${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
};
export const wallClock = (s: number) => new Date(s * 1000).toLocaleTimeString('cs-CZ');
export const minutes = (m: number | null | undefined) => m == null ? 'nehlášeno' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
export const plural = (n: number, one: string, few: string, many: string) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;
export const percent = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)} %`;

export function gameFormat(data: GameData) {
	const units = UNITS[data.game];
	const name = (kind: keyof GameData['names']) => (id: string | null) => id ? data.names[kind][id] ?? id : '';
	return {
		units,
		dist: (km: number) => fmt(km * units.km),
		speed: (kmh: number) => fmt(kmh * units.km),
		volume: (litres: number) => fmt(litres * units.litre),
		// What the game's truck computer shows: l/100 km in ETS2, miles per US gallon in ATS.
		consumption: (litres: number, km: number) => (data.game === 'ats' ? km * units.km / (litres * units.litre) : litres / km * 100).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		money: (n: number) => data.game === 'ats' ? `${n < 0 ? '−' : ''}$${fmt(Math.abs(n))}` : `${n < 0 ? '−' : ''}${fmt(Math.abs(n))} €`,
		company: name('companies'),
		city: name('cities'),
		cargo: name('cargo'),
		truck: name('trucks'),
		vehicle: (truck: string | null, plate: string | null | undefined) => {
			const model = name('trucks')(truck);
			return model && plate ? `${model} (${plate})` : model;
		},
	};
}

export type Format = ReturnType<typeof gameFormat>;

export const GameContext = createContext<{ data: GameData; f: Format; reload: () => void } | null>(null);
export const useGame = () => useContext(GameContext)!;
