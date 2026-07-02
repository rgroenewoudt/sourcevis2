// Git log parsing. Two formats, auto-detected:
//
// 1. "git" — output of:
//      git log --pretty=format:"%at|%an|%ae" --name-status --reverse
//    i.e. per commit a `timestamp|name|email` header followed by
//    --name-status lines (A/M/D/T/R<n>/C<n>, tab-separated).
//
// 2. "gource" — Gource's custom log format:
//      timestamp|username|A/M/D|/path/to/file
//
// Parsing is tolerant: CRLF stripped, unrecognized lines counted and skipped,
// commits with no file lines (merges) accepted. Chunked so huge logs never
// block the UI.

const CHUNK_LINES = 20000;

const GIT_HEADER_RE = /^(\d{6,})\|(.*)\|([^|]*)$/;      // ts | name (may contain |) | email
const STATUS_RE = /^([AMDT])\t(.+)$/;
const RENAME_RE = /^R\d*\t([^\t]+)\t(.+)$/;
const COPY_RE = /^C\d*\t[^\t]+\t(.+)$/;
const GOURCE_RE = /^(\d+)\|([^|]*)\|([AMD])\|(.+)$/;

/** Unquote git's C-style quoted paths ("with \t, \", \\ and \NNN octal escapes). */
export function unquoteGitPath(path) {
  if (path.length < 2 || path[0] !== '"' || path[path.length - 1] !== '"') return path;
  const inner = path.slice(1, -1);
  try {
    const bytes = [];
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch !== '\\') {
        // Non-escaped chars are ASCII in git's quoted form; charCodeAt is safe.
        bytes.push(inner.charCodeAt(i));
        continue;
      }
      const next = inner[++i];
      if (next >= '0' && next <= '7') {
        // up to 3 octal digits
        let oct = next;
        while (oct.length < 3 && inner[i + 1] >= '0' && inner[i + 1] <= '7') oct += inner[++i];
        bytes.push(parseInt(oct, 8));
      } else {
        const map = { t: 9, n: 10, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
        bytes.push(map[next] ?? next.charCodeAt(0));
      }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return path;
  }
}

function detectFormat(lines) {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (GOURCE_RE.test(line)) return 'gource';
    if (GIT_HEADER_RE.test(line)) return 'git';
    return 'git'; // unknown first line: assume git, tolerant parser will skip it
  }
  return 'git';
}

function normalizePath(p) {
  p = unquoteGitPath(p);
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

/**
 * @param {string} text raw log file contents
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<{commits, minTime, maxTime, format, skippedLines}>}
 */
export async function parseLog(text, onProgress) {
  const lines = text.split('\n');
  const format = detectFormat(lines.slice(0, 50));
  const commits = [];
  let skippedLines = 0;
  let current = null; // git format: commit being assembled

  for (let start = 0; start < lines.length; start += CHUNK_LINES) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    for (let i = start; i < end; i++) {
      let line = lines[i];
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;

      if (format === 'gource') {
        const m = GOURCE_RE.exec(line);
        if (!m) { skippedLines++; continue; }
        const time = parseInt(m[1], 10);
        const name = m[2] || 'unknown';
        // Group consecutive same-time/same-user lines into one commit.
        if (!current || current.time !== time || current.authorName !== name) {
          current = { time, authorName: name, authorEmail: '', changes: [] };
          commits.push(current);
        }
        current.changes.push({ action: m[3], path: normalizePath(m[4]) });
        continue;
      }

      // git format
      const h = GIT_HEADER_RE.exec(line);
      if (h) {
        current = {
          time: parseInt(h[1], 10),
          authorName: h[2].trim() || 'unknown',
          authorEmail: h[3].trim(),
          changes: [],
        };
        commits.push(current);
        continue;
      }
      if (!current) { skippedLines++; continue; }
      let m;
      if ((m = STATUS_RE.exec(line))) {
        const action = m[1] === 'T' ? 'M' : m[1]; // typechange -> modify
        current.changes.push({ action, path: normalizePath(m[2]) });
      } else if ((m = RENAME_RE.exec(line))) {
        current.changes.push({ action: 'D', path: normalizePath(m[1]) });
        current.changes.push({ action: 'A', path: normalizePath(m[2]) });
      } else if ((m = COPY_RE.exec(line))) {
        current.changes.push({ action: 'A', path: normalizePath(m[1]) });
      } else {
        skippedLines++;
      }
    }
    if (onProgress) onProgress(end / lines.length);
    if (end < lines.length) await new Promise(r => setTimeout(r));
  }

  // --reverse should already give ascending order, but sort defensively (stable).
  commits.sort((a, b) => a.time - b.time);

  const minTime = commits.length ? commits[0].time : 0;
  const maxTime = commits.length ? commits[commits.length - 1].time : 0;
  return { commits, minTime, maxTime, format, skippedLines };
}
