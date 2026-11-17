export function Stat({ label, value, unit, note, tone }: { label: string; value: string; unit?: string; note?: string; tone?: 'accent' | 'bad' }) {
	return (
		<div className="stat">
			<div className="label">{label}</div>
			<div className={`value ${tone ?? ''}`}>{value}{unit && <span className="unit"> {unit}</span>}</div>
			{note && <div className="note">{note}</div>}
		</div>
	);
}
