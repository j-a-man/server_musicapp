// ── State ──────────────────────────────────────────────────────────────────
const state = {
  songs: [],
  playlists: [],
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  isShuffled: false,
  isRepeating: false,
  currentView: 'library',
  prevView: 'library',
  pendingAddSongId: null,
  currentPlaylistId: null,
};

// ── Audio ───────────────────────────────────────────────────────────────────
const audio = new Audio();
audio.preload = 'metadata';

// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const views = {
  library: $('view-library'),
  search: $('view-search'),
  nowplaying: $('view-nowplaying'),
};

// ── Navigation ──────────────────────────────────────────────────────────────
function showView(name) {
  if (name === 'nowplaying') {
    state.prevView = state.currentView;
  }
  state.currentView = name;

  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[name]) views[name].classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

// PASTE THIS NEW BLOCK:
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // If they click the Library tab, refresh the view to show ALL songs
    // instead of staying stuck on a specific playlist.
    if (btn.dataset.view === 'library') {
      loadLibrary(); 
    }
    showView(btn.dataset.view);
  });
});

$('btn-back-from-player').addEventListener('click', () => {
  showView(state.prevView || 'library');
});

$('btn-open-nowplaying').addEventListener('click', () => showView('nowplaying'));

// ── Library ─────────────────────────────────────────────────────────────────
async function loadLibrary() {
  state.currentPlaylistId = null;
  try {
    const res = await fetch('/api/library');
    const data = await res.json();
    state.songs = data.songs || [];
    renderLibrary();
  } catch (e) {
    console.error('Failed to load library', e);
  }
}

function renderLibrary() {
  const list = $('library-list');
  const empty = $('library-empty');
  $('song-count').textContent = state.songs.length ? `${state.songs.length} songs` : '';

  if (!state.songs.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.songs.map((s, i) => songItemHTML(s, i)).join('');

  list.querySelectorAll('.song-item').forEach((el, i) => {
    el.addEventListener('click', e => {
      if (e.target.closest('.song-menu-btn')) return;
      playFromLibrary(i);
    });
    el.querySelector('.song-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      openContextMenu(e, state.songs[i]);
    });
  });
  highlightCurrentSong();
}

function songItemHTML(song, i) {
  const dur = formatDuration(song.duration);
  const thumb = song.thumbnail
    ? `<img src="${escHtml(song.thumbnail)}" alt="" onerror="this.style.display='none'" />`
    : '♪';
  return `
    <div class="song-item" data-id="${song.id}">
      <div class="song-thumb">${thumb}</div>
      <div class="song-info">
        <div class="song-title">${escHtml(song.title)}</div>
        <div class="song-artist">${escHtml(song.artist || '—')}</div>
      </div>
      <span class="song-duration">${dur}</span>
      <button class="song-menu-btn" title="More options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>`;
}

function highlightCurrentSong() {
  const current = currentSong();
  document.querySelectorAll('.song-item').forEach(el => {
    el.classList.toggle('playing', current && Number(el.dataset.id) === current.id);
  });
}

// ── Context Menu ─────────────────────────────────────────────────────────────
let activeMenu = null;
function openContextMenu(e, song) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-action="play">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play
    </div>
    <div class="ctx-item" data-action="add-playlist">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Playlist
    </div>
    <div class="ctx-item danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete
    </div>`;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 160)}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  document.body.appendChild(menu);
  activeMenu = menu;

  menu.addEventListener('click', async ev => {
    const action = ev.target.closest('.ctx-item')?.dataset.action;
    if (!action) return;
    closeContextMenu();
    if (action === 'play') {
      const idx = state.songs.findIndex(s => s.id === song.id);
      if (idx >= 0) playFromLibrary(idx);
    } else if (action === 'add-playlist') {
      openAddToPlaylist(song.id);
    } else if (action === 'delete') {
      await deleteSong(song.id);
    }
  });

  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

// ── Delete Song ──────────────────────────────────────────────────────────────
async function deleteSong(songId) {
  try {
    await fetch(`/api/library/${songId}`, { method: 'DELETE' });
    if (currentSong()?.id === songId) {
      audio.pause();
      state.queue = [];
      state.queueIndex = -1;
      updateMiniPlayer();
      updateNowPlayingUI();
    }
    await loadLibrary();
    toast('Song deleted');
  } catch (e) {
    toast('Failed to delete song');
  }
}

// ── Playlists Panel ──────────────────────────────────────────────────────────
async function loadPlaylists() {
  const res = await fetch('/api/playlists');
  const data = await res.json();
  state.playlists = data.playlists || [];
  renderPlaylists();
}

function renderPlaylists() {
  const list = $('playlists-list');
  if (!state.playlists.length) {
    list.innerHTML = '<div class="empty-state"><p style="padding:20px 0">No playlists yet</p></div>';
    return;
  }
  
  list.innerHTML = state.playlists.map(p => `
    <div class="playlist-item" data-id="${p.id}">
      <div class="playlist-info">
        <div class="playlist-name">${escHtml(p.name)}</div>
      </div>
      <button class="playlist-del-btn" data-id="${p.id}" title="Delete playlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  // Handle Clicking a Playlist to LOAD IT
  list.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      // Don't trigger if they clicked the delete button
      if (e.target.closest('.playlist-del-btn')) return;
      
      const id = item.dataset.id;
      
      try {
        const res = await fetch(`/api/playlists/${id}`);
        if (!res.ok) throw new Error("Server error");
        
        const data = await res.json();
        
        // Update the state with the songs from the playlist
        state.songs = data.songs || [];
        state.currentPlaylistId = id;
        
        // Use data.name directly from the server response (safer than searching state)
        const playlistName = data.name || "Playlist";
        
        // Update UI
        $('song-count').textContent = `Playlist: ${playlistName} (${state.songs.length} songs)`;
        renderLibrary();
        closePlaylists();
        showView('library');
        
        toast(`Loaded ${playlistName}`);
      } catch (err) {
        console.error("Playlist Load Error:", err); // This shows the real error in F12 console
        toast("Failed to load playlist");
      }
    });
  });


  // Handle Delete
  list.querySelectorAll('.playlist-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if(!confirm("Delete this playlist?")) return;
      await fetch(`/api/playlists/${btn.dataset.id}`, { method: 'DELETE' });
      await loadPlaylists();
    });
  });
}


$('btn-open-playlists').addEventListener('click', () => {
  loadPlaylists();
  $('panel-playlists').classList.remove('hidden');
  $('panel-overlay').classList.remove('hidden');
});
$('btn-close-playlists').addEventListener('click', closePlaylists);
$('panel-overlay').addEventListener('click', closePlaylists);
function closePlaylists() {
  $('panel-playlists').classList.add('hidden');
  $('panel-overlay').classList.add('hidden');
}

$('btn-new-playlist').addEventListener('click', async () => {
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  await fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
  await loadPlaylists();
});

// ── Add to Playlist Modal ─────────────────────────────────────────────────────
async function openAddToPlaylist(songId) {
  state.pendingAddSongId = songId;
  await loadPlaylists();
  const opts = $('modal-playlist-options');
  if (!state.playlists.length) {
    opts.innerHTML = '<div class="modal-option" style="color:var(--text-muted)">No playlists — create one first</div>';
  } else {
    opts.innerHTML = state.playlists.map(p =>
      `<div class="modal-option" data-playlist-id="${p.id}">${escHtml(p.name)}</div>`
    ).join('');
    opts.querySelectorAll('.modal-option').forEach(el => {
      el.addEventListener('click', async () => {
        await fetch(`/api/playlists/${el.dataset.playlistId}/songs/${state.pendingAddSongId}`, { method: 'POST' });
        $('modal-add-playlist').classList.add('hidden');
        toast('Added to playlist');
      });
    });
  }
  $('modal-add-playlist').classList.remove('hidden');
}
$('btn-modal-cancel').addEventListener('click', () => $('modal-add-playlist').classList.add('hidden'));

// ── Search ───────────────────────────────────────────────────────────────────
let searchDebounce = null;
$('search-btn').addEventListener('click', doSearch);
$('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  $('search-results').innerHTML = '<div class="empty-state"><div class="empty-icon" style="animation:pulse 1s infinite">⏳</div><p>Searching…</p></div>';
  $('search-empty').classList.add('hidden');
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderSearchResults(data.results || []);
  } catch (e) {
    $('search-results').innerHTML = '<div class="empty-state"><p>Search failed. Is the server running?</p></div>';
  }
}

// Track which songs are being downloaded / done this session
const downloadedUrls = new Set();

function renderSearchResults(results) {
  const container = $('search-results');
  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
    return;
  }
  container.innerHTML = results.map(r => {
    const dur = formatDuration(r.duration);
    const thumb = r.thumbnail ? `<img src="${escHtml(r.thumbnail)}" alt="" onerror="this.style.display='none'" />` : '♫';
    const alreadyDone = downloadedUrls.has(r.url);
    return `
      <div class="result-item" data-url="${escHtml(r.url)}">
        <div class="result-thumb">${thumb}</div>
        <div class="result-info">
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-channel">${escHtml(r.channel || '')}</div>
          <div class="result-duration">${dur}</div>
        </div>
        <div class="result-actions">
          <button class="btn-download ${alreadyDone ? 'done' : ''}" data-url="${escHtml(r.url)}" data-title="${escHtml(r.title)}" data-artist="${escHtml(r.channel || '')}" data-thumb="${escHtml(r.thumbnail || '')}" data-duration="${r.duration || 0}" title="Download">
            ${alreadyDone
              ? `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`
              : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
            }
          </button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('downloading') || btn.classList.contains('done')) return;
      await startDownload(btn);
    });
  });
}

async function startDownload(btn) {
  const { url, title, artist, thumb, duration } = btn.dataset;
  btn.classList.add('downloading');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/></svg>`;

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, artist, thumbnail: thumb, duration: parseInt(duration) || 0 }),
    });
    const data = await res.json();
    pollDownloadStatus(data.song_id, btn, url);
  } catch (e) {
    btn.classList.remove('downloading');
    toast('Download failed');
  }
}

function pollDownloadStatus(songId, btn, url) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/download/status/${songId}`);
      const data = await res.json();
      if (data.status === 'done') {
        clearInterval(interval);
        btn.classList.remove('downloading');
        btn.classList.add('done');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`;
        downloadedUrls.add(url);
        toast('Download complete!');
        await loadLibrary();
      } else if (data.status.startsWith('error')) {
        clearInterval(interval);
        btn.classList.remove('downloading');
        toast('Download failed');
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 2000);
}

// ── Playback ─────────────────────────────────────────────────────────────────
function currentSong() {
  return state.queue[state.queueIndex] || null;
}

function playFromLibrary(index) {
  state.queue = [...state.songs];
  state.queueIndex = index;
  playCurrent();
}

function playCurrent() {
  const song = currentSong();
  if (!song) return;
  audio.src = `/api/stream/${song.id}`;
  audio.load();
  audio.play().catch(console.error);
  state.isPlaying = true;
  updateNowPlayingUI();
  updateMiniPlayer();
  highlightCurrentSong();
  setupMediaSession();
}

function togglePlay() {
  if (!currentSong()) return;
  if (audio.paused) {
    audio.play().catch(console.error);
    state.isPlaying = true;
  } else {
    audio.pause();
    state.isPlaying = false;
  }
  updatePlayButtons();
}

function nextSong() {
  if (!state.queue.length) return;
  if (state.isShuffled) {
    state.queueIndex = Math.floor(Math.random() * state.queue.length);
  } else {
    state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  }
  playCurrent();
}

function prevSong() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  playCurrent();
}

audio.addEventListener('ended', () => {
  if (state.isRepeating) {
    audio.currentTime = 0;
    audio.play();
  } else {
    nextSong();
  }
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  $('np-progress').value = pct;
  $('np-current').textContent = formatDuration(Math.floor(audio.currentTime));
});

audio.addEventListener('loadedmetadata', () => {
  $('np-duration').textContent = formatDuration(Math.floor(audio.duration));
});

audio.addEventListener('play', () => { state.isPlaying = true; updatePlayButtons(); });
audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayButtons(); });

$('np-progress').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

// ── Controls ─────────────────────────────────────────────────────────────────
$('btn-play-np').addEventListener('click', togglePlay);
$('btn-play-mini').addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
$('btn-next').addEventListener('click', nextSong);
$('btn-prev').addEventListener('click', prevSong);
$('btn-mini-next').addEventListener('click', e => { e.stopPropagation(); nextSong(); });

$('btn-shuffle').addEventListener('click', () => {
  state.isShuffled = !state.isShuffled;
  $('btn-shuffle').classList.toggle('active', state.isShuffled);
  toast(state.isShuffled ? 'Shuffle on' : 'Shuffle off');
});

$('btn-repeat').addEventListener('click', () => {
  state.isRepeating = !state.isRepeating;
  $('btn-repeat').classList.toggle('active', state.isRepeating);
  toast(state.isRepeating ? 'Repeat on' : 'Repeat off');
});

// ── UI Updates ────────────────────────────────────────────────────────────────
function updatePlayButtons() {
  const playing = state.isPlaying;
  $('icon-play-np').classList.toggle('hidden', playing);
  $('icon-pause-np').classList.toggle('hidden', !playing);
  $('icon-play-mini').classList.toggle('hidden', playing);
  $('icon-pause-mini').classList.toggle('hidden', !playing);
  if (navigator.mediaSession) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

function updateNowPlayingUI() {
  const song = currentSong();
  if (!song) return;
  $('np-title').textContent = song.title;
  $('np-artist').textContent = song.artist || '—';
  const img = $('np-artwork-img');
  if (song.thumbnail) { img.src = song.thumbnail; img.style.display = ''; }
  else { img.src = ''; img.style.display = 'none'; }
  updatePlayButtons();
}

function updateMiniPlayer() {
  const song = currentSong();
  const mini = $('mini-player');
  if (!song) { mini.classList.add('hidden'); return; }
  mini.classList.remove('hidden');
  $('mini-title').textContent = song.title;
  $('mini-artist').textContent = song.artist || '—';
  const art = $('mini-artwork');
  if (song.thumbnail) {
    art.innerHTML = `<img src="${escHtml(song.thumbnail)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" onerror="this.parentElement.textContent='♪'" />`;
  } else {
    art.textContent = '♪';
  }
  updatePlayButtons();
}

// ── MediaSession (lock screen controls) ──────────────────────────────────────
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const song = currentSong();
  if (!song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist || '',
    artwork: song.thumbnail ? [{ src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
  navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
  navigator.mediaSession.setActionHandler('nexttrack', nextSong);
  navigator.mediaSession.setActionHandler('previoustrack', prevSong);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs || isNaN(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(console.error);
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadLibrary();
