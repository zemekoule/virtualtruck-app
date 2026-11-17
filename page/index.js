const delivered = DATA.jobs.filter(j => j.status === 'delivered');
const cities = new Set(delivered.flatMap(j => [j.src_city, j.dst_city]).filter(Boolean));
const recorded = kind => DATA.jobs.filter(j => j.telemetry && j.kind === kind).length;
const jobsText = n => `${fmt(n)} ${plural(n, 'zakázka', 'zakázky', 'zakázek')}`;
document.getElementById('nakladni').textContent = `Zaznamenáno pluginem: ${jobsText(recorded('truck'))}. Trasa, rychlost, spotřeba, pokuty.`;
document.getElementById('osobni').textContent = `Zaznamenáno pluginem: ${jobsText(recorded('car'))}. Hodnocení, spokojenost zákazníka, trasa.`;
document.getElementById('mesta').textContent = `${fmt(cities.size)} ${plural(cities.size, 'město', 'města', 'měst')} z ${jobsText(delivered.length)} – z/do kterých dep jsem vezl.`;
