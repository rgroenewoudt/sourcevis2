// Color assignment for file extensions and authors.

const EXT_PALETTE = {
  js: '#f1e05a', jsx: '#f1e05a', ts: '#3178c6', tsx: '#3178c6', mjs: '#f1e05a',
  cs: '#178600', csproj: '#8bc34a', sln: '#8bc34a', cshtml: '#512bd4', razor: '#512bd4',
  java: '#b07219', kt: '#a97bff', scala: '#c22d40',
  py: '#3572a5', rb: '#701516', php: '#4f5d95', go: '#00add8', rs: '#dea584',
  c: '#9e9e9e', h: '#9e9e9e', cpp: '#f34b7d', hpp: '#f34b7d', cc: '#f34b7d',
  swift: '#f05138', m: '#438eff',
  css: '#886fbf', scss: '#c6538c', less: '#1d6b96', styl: '#ff6347',
  html: '#e34c26', htm: '#e34c26', vue: '#41b883', svelte: '#ff3e00',
  json: '#a8b1c2', xml: '#5b8db8', yml: '#cb4b4b', yaml: '#cb4b4b', toml: '#9c4221',
  md: '#83b9dc', txt: '#9aa5b1', rst: '#83b9dc',
  sh: '#89e051', bash: '#89e051', ps1: '#4273ca', bat: '#c1f12e', cmd: '#c1f12e',
  sql: '#e38c00', graphql: '#e10098',
  png: '#7bb662', jpg: '#7bb662', jpeg: '#7bb662', gif: '#7bb662', svg: '#ffb13b', ico: '#7bb662',
  lock: '#6b7280', config: '#6b7280', conf: '#6b7280', ini: '#6b7280', env: '#6b7280',
  dockerfile: '#2496ed', tf: '#7b42bc', proto: '#4a90d9',
};

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function extColor(ext) {
  const known = EXT_PALETTE[ext];
  if (known) return known;
  const hue = hashString(ext || 'none') % 360;
  return `hsl(${hue} 65% 62%)`;
}

export function authorColor(name) {
  const hue = hashString(name) % 360;
  return `hsl(${hue} 70% 55%)`;
}

export function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
