// Avatar cache: Gravatar images keyed by author identity, with a colored
// initials-disc fallback that is shown immediately and kept permanently on
// fetch failure. Gravatar lookups use SHA-256 of the normalized email, which
// requires a secure context (localhost qualifies; file:// may not).

const SIZE = 64;
const MAX_CONCURRENT = 6;

const cache = new Map();      // key -> HTMLCanvasElement (disc first, gravatar when loaded)
const requested = new Set();  // keys whose gravatar fetch has been started (never retry)
const queue = [];
let inFlight = 0;

const cryptoOk = typeof crypto !== 'undefined' && !!crypto.subtle;
if (!cryptoOk) {
  console.warn('crypto.subtle unavailable (are you on file://?) — Gravatar disabled, ' +
    'using initials avatars. Serve over http, e.g.: python -m http.server');
}

function makeDisc(inits, color) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `bold ${SIZE * 0.42}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(inits, SIZE / 2, SIZE / 2 + 1);
  return c;
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function pump() {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    inFlight++;
    job().finally(() => {
      inFlight--;
      pump();
    });
  }
}

function queueGravatar(key, email) {
  queue.push(async () => {
    try {
      const hex = await sha256hex(email.trim().toLowerCase());
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = SIZE;
          const ctx = c.getContext('2d');
          ctx.beginPath();
          ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          cache.set(key, c);
          resolve();
        };
        img.onerror = () => resolve(); // 404 / network error: keep the initials disc
        img.src = `https://gravatar.com/avatar/${hex}?s=${SIZE}&d=404`;
      });
    } catch {
      // keep the disc
    }
  });
  pump();
}

/**
 * Returns an avatar canvas for the given identity. Always returns synchronously
 * (initials disc at first); the cache entry is swapped in place once the
 * Gravatar image loads, so callers can just call this every frame.
 */
export function getAvatar(key, email, inits, color) {
  let c = cache.get(key);
  if (!c) {
    c = makeDisc(inits, color);
    cache.set(key, c);
  }
  if (email && cryptoOk && !requested.has(key)) {
    requested.add(key);
    queueGravatar(key, email);
  }
  return c;
}
