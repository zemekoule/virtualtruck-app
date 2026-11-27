const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const TruckIcon = () => <svg width="20" height="20" viewBox="0 0 20 20" {...stroke} aria-hidden="true"><path d="M2 5h10v8H2z M12 8h3l3 3v2h-6" /><circle cx="5.5" cy="14.5" r="1.5" /><circle cx="14.5" cy="14.5" r="1.5" /></svg>;
export const CarIcon = () => <svg width="20" height="20" viewBox="0 0 20 20" {...stroke} aria-hidden="true"><path d="M3 13v-3l2-4h8l3 4v3z M3 10h13" /><circle cx="6.5" cy="14" r="1.5" /><circle cx="13" cy="14" r="1.5" /></svg>;
export const BusIcon = () => <svg width="20" height="20" viewBox="0 0 20 20" {...stroke} aria-hidden="true"><path d="M3 14V4h14v10z M3 9h14 M10 4v5" /><circle cx="6" cy="15" r="1.5" /><circle cx="14" cy="15" r="1.5" /></svg>;
export const CityIcon = () => <svg width="20" height="20" viewBox="0 0 20 20" {...stroke} aria-hidden="true"><path d="M3 17V8l4-2v11 M7 17V4l6 3v10 M13 17V9l4 2v6 M2 17h16" /></svg>;
export const BackIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} strokeWidth={1.8} aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>;
export const SearchIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" {...stroke} aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>;
export const FitIcon = () => <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} strokeWidth={1.8} aria-hidden="true"><path d="M3 7V3h4M15 7V3h-4M3 11v4h4M15 11v4h-4" /></svg>;
