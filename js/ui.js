// DOM layer: controls, HUD, legend, empty state, drag-drop, toasts.
// Communicates upward only via the callbacks passed to initUI.

const GIT_COMMAND = 'git log --pretty=format:"%at|%an|%ae" --name-status --reverse > gitlog.txt';

export function initUI({ onFile, onPlayPause, onSpeed, onSeek, onFollow, onAuthorsChange }) {
  const $ = (id) => document.getElementById(id);
  const emptyState = $('empty-state');
  const fileInput = $('file-input');
  const parseProgress = $('parse-progress');
  const parseFill = $('parse-progress-fill');
  const parseStatus = $('parse-status');
  const controls = $('controls');
  const hud = $('hud');
  const btnPlay = $('btn-play');
  const speedSelect = $('speed-select');
  const seek = $('seek');
  const btnFollow = $('btn-follow');
  const btnAuthors = $('btn-authors');
  const authorsPanel = $('authors-panel');
  const authorsList = $('authors-list');
  const btnLoad = $('btn-load');
  const hudDate = $('hud-date');
  const hudCounts = $('hud-counts');
  const legendEl = $('legend');
  const toastEl = $('toast');

  $('git-command').textContent = GIT_COMMAND;
  $('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(GIT_COMMAND);
      toast('Command copied');
    } catch {
      toast('Copy failed — select the text manually');
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) onFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // Full-page drag & drop (works before and after a log is loaded).
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
    }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });

  // Authors panel: unchecked authors get their commits skipped.
  const authorChecks = new Map(); // key -> checkbox
  function emitAuthorsChange() {
    const excluded = [];
    for (const [key, cb] of authorChecks) {
      cb.closest('.author-row').classList.toggle('excluded', !cb.checked);
      if (!cb.checked) excluded.push(key);
    }
    btnAuthors.classList.toggle('active', excluded.length > 0);
    onAuthorsChange(excluded);
  }
  btnAuthors.addEventListener('click', (e) => {
    e.stopPropagation();
    authorsPanel.classList.toggle('hidden');
  });
  authorsPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => authorsPanel.classList.add('hidden'));
  $('authors-all').addEventListener('click', () => {
    for (const cb of authorChecks.values()) cb.checked = true;
    emitAuthorsChange();
  });
  $('authors-none').addEventListener('click', () => {
    for (const cb of authorChecks.values()) cb.checked = false;
    emitAuthorsChange();
  });

  btnPlay.addEventListener('click', onPlayPause);
  speedSelect.addEventListener('change', () => onSpeed(parseFloat(speedSelect.value)));
  btnFollow.addEventListener('click', onFollow);
  btnLoad.addEventListener('click', () => fileInput.click());

  let seekDragging = false;
  seek.addEventListener('pointerdown', () => { seekDragging = true; });
  seek.addEventListener('pointerup', () => { seekDragging = false; });
  seek.addEventListener('input', () => onSeek(seek.valueAsNumber / 10000));
  seek.addEventListener('change', () => { seekDragging = false; onSeek(seek.valueAsNumber / 10000); });

  let toastTimer = null;
  function toast(msg, ms = 3500) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  let lastLegendKey = '';
  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return {
    toast,
    showEmptyState(show) {
      emptyState.classList.toggle('hidden', !show);
      controls.classList.toggle('hidden', show);
      hud.classList.toggle('hidden', show);
    },
    setParseProgress(fraction) {
      if (fraction === null) {
        parseProgress.classList.add('hidden');
        parseStatus.textContent = '';
        return;
      }
      parseProgress.classList.remove('hidden');
      parseFill.style.width = `${Math.round(fraction * 100)}%`;
      parseStatus.textContent = `Parsing… ${Math.round(fraction * 100)}%`;
    },
    setDate(unixSeconds) {
      hudDate.textContent = dateFmt.format(new Date(unixSeconds * 1000));
    },
    setCounts(files, authors) {
      hudCounts.textContent = `${files.toLocaleString()} files · ${authors.toLocaleString()} authors`;
    },
    /** entries: [{ext, color, count}] — cheap diff: only rewrite when ranking changes. */
    setLegend(entries) {
      const key = entries.map(e => e.ext + e.count).join(',');
      if (key === lastLegendKey) return;
      lastLegendKey = key;
      legendEl.innerHTML = '';
      for (const e of entries) {
        const row = document.createElement('div');
        row.className = 'legend-row';
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = e.color;
        const label = document.createElement('span');
        label.textContent = `${e.ext} (${e.count})`;
        row.append(dot, label);
        legendEl.appendChild(row);
      }
    },
    setSeek(fraction) {
      if (!seekDragging) seek.valueAsNumber = Math.round(fraction * 10000);
    },
    isSeekDragging: () => seekDragging,
    setPlaying(playing) {
      btnPlay.textContent = playing ? '⏸' : '▶';
      btnPlay.title = playing ? 'Pause' : 'Play';
    },
    setFollowMode(auto) {
      btnFollow.classList.toggle('active', auto);
    },
    /** authors: [{key, name, count}] sorted by descending commit count. */
    setAuthors(authors) {
      authorChecks.clear();
      authorsList.innerHTML = '';
      authorsPanel.classList.add('hidden');
      btnAuthors.classList.remove('active');
      for (const a of authors) {
        const row = document.createElement('label');
        row.className = 'author-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', emitAuthorsChange);
        const name = document.createElement('span');
        name.className = 'author-name';
        name.textContent = a.name;
        name.title = a.name;
        const count = document.createElement('span');
        count.className = 'author-count';
        count.textContent = a.count.toLocaleString();
        row.append(cb, name, count);
        authorsList.appendChild(row);
        authorChecks.set(a.key, cb);
      }
    },
  };
}
