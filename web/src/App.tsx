import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { currentUser, loadGame, logout, Unauthenticated, type User } from './api';
import { GAME_SHORT, GameContext, gameFormat } from './format';
import { Login } from './Login';
import { Cargo } from './pages/Cargo';
import { Cities } from './pages/Cities';
import { JobDetail } from './pages/JobDetail';
import { Jobs } from './pages/Jobs';
import { Live } from './pages/Live';
import { Fuel } from './pages/Fuel';
import { Refuels } from './pages/Refuels';
import { Settings } from './pages/Settings';
import { Overview } from './pages/Overview';
import { Stats } from './pages/Stats';
import type { GameData, GameId } from './types';

const GAMES: GameId[] = ['ats', 'eut2'];
// Loaded once per game; switching pages does not reload it.
const cache = new Map<GameId, Promise<GameData>>();
const AuthContext = createContext<{ user: User; logout: () => void } | null>(null);

function Logo() {
	return (
		<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="6" cy="20" r="2.5" /><circle cx="20" cy="6" r="2.5" /><path d="M8.5 20h6a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h6" />
		</svg>
	);
}

function Header({ game }: { game: GameId }) {
	const { pathname } = useLocation();
	const auth = useContext(AuthContext)!;
	// The other game keeps the section, a job detail goes back to its list; car jobs are only in ATS, bus jobs only in ETS2.
	const section = (other: GameId) => {
		const s = pathname.split('/')[2] ?? '';
		return (other === 'eut2' && s === 'osobni') || (other === 'ats' && s === 'autobusy') ? 'zakazky' : s;
	};
	return (
		<header className="topbar">
			<Link to={`/${game}`} className="brand"><Logo />VirtualTruck</Link>
			<div className="segmented" role="group" aria-label="Hra">
				{GAMES.map(g => <Link key={g} to={`/${g}/${section(g)}`} className={g === game ? 'active' : ''}>{GAME_SHORT[g]}</Link>)}
			</div>
			<nav className="nav">
				<NavLink to={`/${game}`} end>Přehled</NavLink>
				<NavLink to={`/${game}/zakazky`}>Zakázky</NavLink>
				{game === 'ats' && <NavLink to={`/${game}/osobni`}>Osobní</NavLink>}
				{game === 'eut2' && <NavLink to={`/${game}/autobusy`}>Autobusy</NavLink>}
				<NavLink to={`/${game}/mesta`}>Města</NavLink>
				<NavLink to={`/${game}/naklady`}>Náklady</NavLink>
				<NavLink to={`/${game}/palivo`}>Palivo</NavLink>
				<NavLink to={`/${game}/tankovani`}>Tankování</NavLink>
				<NavLink to={`/${game}/statistiky`}>Statistiky</NavLink>
				<NavLink to={`/${game}/zive`}>Živě</NavLink>
			</nav>
			<NavLink to={`/${game}/nastaveni`} className="text-button">Nastavení</NavLink>
			<button type="button" className="text-button" title={auth.user.email} onClick={auth.logout}>Odhlásit</button>
		</header>
	);
}

function GameLayout() {
	const game = useParams().game as GameId;
	const auth = useContext(AuthContext)!;
	const [state, setState] = useState<{ game: GameId; data?: GameData; error?: string }>({ game });
	const load = useCallback((fresh: boolean) => {
		if (fresh || !cache.has(game)) cache.set(game, loadGame(game));
		cache.get(game)!.then(data => setState({ game, data }), (e: Error) => {
			cache.delete(game);
			if (e instanceof Unauthenticated) return auth.logout();
			setState({ game, error: e.message });
		});
	}, [game, auth]);
	useEffect(() => load(false), [load]);
	const data = state.game === game ? state.data : undefined;
	const value = useMemo(() => data && { data, f: gameFormat(data), reload: () => load(true) }, [data, load]);

	if (!GAMES.includes(game)) return <Navigate to="/ats" replace />;
	return (
		<div className="app">
			<Header game={game} />
			{state.error ? <p className="page bad">Data se nenačetla: {state.error}</p>
				: value ? <GameContext.Provider value={value}><Outlet /></GameContext.Provider>
				: <p className="page muted">Načítám data…</p>}
		</div>
	);
}

export function App() {
	const [user, setUser] = useState<User | null | undefined>(undefined);
	const [error, setError] = useState('');
	const check = useCallback(() => {
		cache.clear();
		currentUser().then(setUser, (e: Error) => setError(e.message));
	}, []);
	useEffect(check, [check]);
	// Logs out also when the session expired, then only the page state is cleared.
	const auth = useMemo(() => user && { user, logout: () => logout().catch(() => {}).finally(() => setUser(null)) }, [user]);

	if (error) return <p className="page bad">API neodpovídá: {error}</p>;
	if (user === undefined) return <p className="page muted">Načítám…</p>;
	if (!auth) return <Login onLogin={check} />;
	return (
		<AuthContext.Provider value={auth}>
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<Navigate to="/ats" replace />} />
				<Route path="/:game" element={<GameLayout />}>
					<Route index element={<Overview />} />
					<Route path="zakazky" element={<Jobs kind="truck" />} />
					<Route path="zakazky/:id" element={<JobDetail />} />
					<Route path="osobni" element={<Jobs kind="car" />} />
					<Route path="osobni/:id" element={<JobDetail />} />
					<Route path="autobusy" element={<Jobs kind="bus" />} />
					<Route path="autobusy/:id" element={<JobDetail />} />
					<Route path="mesta" element={<Cities />} />
					<Route path="naklady" element={<Cargo />} />
					<Route path="palivo" element={<Fuel />} />
					<Route path="tankovani" element={<Refuels />} />
					<Route path="statistiky" element={<Stats />} />
					<Route path="zive" element={<Live />} />
					<Route path="nastaveni" element={<Settings />} />
				</Route>
			</Routes>
		</BrowserRouter>
		</AuthContext.Provider>
	);
}
