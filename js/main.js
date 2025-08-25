// js/main.js
import * as state from './state.js';
import * as ui from './ui.js';
import { websocket } from './websocket.js';

// --- Debug Logger Setup ---
const log = (level, ...args) => ui.logToDebugPanel(level, ...args);

// --- Global Error Catcher for Debugging ---
window.onerror = function (message, source, lineno, colno, error) {
    log('error', `Uncaught Error: ${message}`, `at ${source}:${lineno}:${colno}`, error);
    return false;
};

let nowPlayingSongName = null;

// --- Genre Cleaning Algorithm ---
function titleCase(str) {
    if (!str) return '';
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function cleanGenreName(rawGenre) {
    if (!rawGenre || typeof rawGenre !== 'string') return 'Unknown';
    let clean = rawGenre.toLowerCase().trim();
    const genreAliases = {
        'poprock': 'Pop Rock', 'pop rock': 'Pop Rock', 'pop/rock': 'Pop Rock',
        'classicrock': 'Classic Rock', 'rock and roll': 'Rock',
        'indierock': 'Indie Rock', 'indie': 'Indie Rock',
        'new_wave': 'New Wave', 'new wave': 'New Wave',
        'prog': 'Progressive Rock',
        'numetal': 'Nu-Metal',
        'glam': 'Glam Rock',
        'rhsoundtrack': 'Soundtrack',
        'hip-hop/rap': 'Hip Hop', 'hip-hop': 'Hip Hop',
        'r&bsoul': 'R&B/Soul', 'r&bsoul/funk': 'R&B/Soul', 'rhythm & blues': 'R&B/Soul',
        '1981\'s': 'Pop',
        'alternative': 'Alternative Rock',
        'punk-metal': 'Punk',
        'post-hardcore': 'Hardcore', 'post-grunge': 'Grunge',
        'power metal/speed metal': 'Power Metal',
        'reggae/ska': 'Reggae', 'ska-punk': 'Ska',
        'emo-pop': 'Emo',
        'vocal': 'Vocal',
        'latin': 'Latin'
    };
    clean = genreAliases[clean] || clean;
    return titleCase(clean);
}

// --- Core Application Logic ---
function renderAll() {
    log('info', '--- renderAll ---');
    processAndRenderSongList();
    ui.renderRequests();
    ui.updateButtonCounts();
}

function processAndRenderSongList() {
    log('render', 'Processing and rendering song list...');
    const requestedSongNames = new Set(state.currentRequests.map(s => s.Name));
    const sortedSongs = [...state.allSongs].sort((a, b) => {
        if (state.mainListSort.primary.field) {
            let valA = state.mainListSort.primary.field === 'favorite' ? state.favorites.has(a.Name) : requestedSongNames.has(a.Name);
            let valB = state.mainListSort.primary.field === 'favorite' ? state.favorites.has(b.Name) : requestedSongNames.has(b.Name);
            if (valA !== valB) return state.mainListSort.primary.direction === 'desc' ? Number(valB) - Number(valA) : Number(valA) - Number(valB);
        }
        const secondaryValA = a[state.mainListSort.secondary.field] || '';
        const secondaryValB = b[state.mainListSort.secondary.field] || '';
        const comparison = secondaryValA.localeCompare(secondaryValB);
        return state.mainListSort.secondary.direction === 'asc' ? comparison : -comparison;
    });

    let filteredSongs = sortedSongs.filter(song => !state.hiddenSongs.has(song.Name));
    if (state.activeGenres.size > 0) {
        filteredSongs = filteredSongs.filter(song => state.activeGenres.has(song.parentGenre) || state.activeGenres.has(song.subGenre));
    }
    const query = ui.elements.songList.searchBox.value.toLowerCase().trim();
    if (query) {
        filteredSongs = filteredSongs.filter(s => s.Name.toLowerCase().includes(query) || s.Artist.toLowerCase().includes(query));
    }
    state.setDisplayedSongs(filteredSongs);
    ui.renderSongList();
    log('render', `Finished rendering song list. ${filteredSongs.length} songs shown.`);
}

// --- Event Handlers ---
function handleSongListInteraction(e) {
    const target = e.target;
    log('event', 'handleSongListInteraction triggered by:', target);
    
    const parent = target.closest('[data-song-name]');
    if (!parent) {
        log('event', 'No parent [data-song-name] found. Exiting.');
        return;
    }

    const songName = parent.dataset.songName;
    log('event', `Action on song: ${songName}`);

    if (target.closest('.request-btn')) {
        log('action', 'Request button clicked.');
        const songToUpdate = state.allSongs.find(s => s.Name === songName);
        const action = target.closest('.request-btn').classList.contains('requested') ? 'remove' : 'add';
        const payload = { action, songName, userAvatar: state.userAvatar };
        if (action === 'add') {
            payload.song = { ...songToUpdate, userAvatar: state.userAvatar };
        }
        log('websocket', 'Sending message:', payload);
        websocket.send(payload);
    } else if (target.closest('.favorite-btn')) {
        log('action', 'Favorite button clicked.');
        state.favorites.has(songName) ? state.favorites.delete(songName) : state.favorites.add(songName);
        state.saveFavorites();
        renderAll();
    } else if (target.closest('.hide-btn')) {
        log('action', 'Hide button clicked.');
        const songToHide = target.closest('.hide-btn').dataset.songNameHide;
        const artistToHide = target.closest('.hide-btn').dataset.artistName;
        if (songToHide) {
            state.hiddenSongs.add(songToHide);
        }
        if (artistToHide) {
            state.allSongs.forEach(s => {
                if (s.Artist === artistToHide) state.hiddenSongs.add(s.Name);
            });
        }
        state.saveHiddenSongs();
        processAndRenderSongList();
        ui.updateButtonCounts();
    }
}

function setupEventListeners() {
    log('init', 'Setting up event listeners.');
    document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', (e) => ui.openTab(e)));
    
    const tooltipElements = [ui.elements.songList.container, ui.elements.songList.tableBody, ui.elements.upNext.list];
    tooltipElements.forEach(el => {
        el.addEventListener('mouseover', e => {
            const parent = e.target.closest('[data-song-name]');
            if (parent && !e.target.closest('button')) {
                const song = state.allSongs.find(s => s.Name === parent.dataset.songName);
                ui.startTooltipTimer(song, e);
            }
        });
        el.addEventListener('mouseout', ui.hideSongTooltip);
        el.addEventListener('mousemove', ui.trackTooltipPosition);
    });

    [ui.elements.songList.container, ui.elements.songList.tableBody].forEach(el => el.addEventListener('click', handleSongListInteraction));

    ui.elements.upNext.list.addEventListener('click', e => {
        const parent = e.target.closest('li[data-song-name]');
        if (!parent) return;
        const songName = parent.dataset.songName;

        if (e.target.closest('.unrequest-btn')) {
            websocket.send({ action: 'remove', songName, userAvatar: state.userAvatar });
        } else if (e.target.closest('.favorite-btn')) {
            state.favorites.has(songName) ? state.favorites.delete(songName) : state.favorites.add(songName);
            state.saveFavorites();
            renderAll();
        } else if (e.target.closest('.admin-action-remove')) {
            websocket.send({ action: 'forceRemove', songName });
        } else if (e.target.closest('.admin-action-top')) {
            const newOrder = [songName, ...state.currentRequests.map(s => s.Name).filter(name => name !== songName)];
            websocket.send({ action: 'reorder', songs: newOrder });
        }
    });

    ui.elements.songList.tableHead.addEventListener('click', (e) => {
        const target = e.target.closest('button, th');
        if (!target) return;
        const primaryField = target.dataset.sortPrimary;
        const secondaryField = target.dataset.sortField;
        if (primaryField) {
            if (state.mainListSort.primary.field === primaryField) {
                state.mainListSort.primary.direction = state.mainListSort.primary.direction === 'desc' ? 'asc' : 'desc';
            } else {
                state.mainListSort.primary.field = primaryField;
                state.mainListSort.primary.direction = 'desc';
            }
        } else if (secondaryField) {
            if (state.mainListSort.secondary.field === secondaryField) {
                state.mainListSort.secondary.direction = state.mainListSort.secondary.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.mainListSort.secondary.field = secondaryField;
                state.mainListSort.secondary.direction = 'asc';
            }
        }
        processAndRenderSongList();
    });

    ui.elements.songList.sortButtons.addEventListener('click', (e) => {
        const target = e.target;
        if (target.id === 'randomizeViewBtn') {
            const shuffled = [...state.displayedSongs].sort(() => 0.5 - Math.random());
            state.setDisplayedSongs(shuffled);
            ui.renderSongList();
            ui.showToast("Song list view randomized!");
        } else if (target.dataset.sortField) {
            const newSort = { primary: { field: null }, secondary: { field: target.dataset.sortField, direction: 'asc' } };
            state.setMainListSort(newSort);
            ui.elements.songList.sortButtons.querySelector('.active').classList.remove('active');
            target.classList.add('active');
            processAndRenderSongList();
        }
    });

    ui.elements.upNext.timeSortButtons.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target || !target.dataset.sort) return;

        const sortType = target.dataset.sort;
        if (sortType === 'random') {
            const shuffledNames = [...state.currentRequests].sort(() => 0.5 - Math.random()).map(s => s.Name);
            websocket.send({ action: 'reorder', songs: shuffledNames });
            ui.showToast("Queue order randomized!");
            return;
        }
        
        state.setUpNextTimeSort(sortType);
        document.querySelectorAll('#upNextTimeSortButtons .sort-btn').forEach(btn => btn.classList.remove('active'));
        target.classList.add('active');
        ui.showToast(`Sorting by ${target.textContent}`);
        ui.renderRequests();
    });

    ui.elements.upNext.favSortButton.addEventListener('click', (e) => {
        state.setUpNextFavoritesTop(!state.upNextFavoritesTop);
        e.target.classList.toggle('active', state.upNextFavoritesTop);
        ui.showToast(`Favorites on top: ${state.upNextFavoritesTop ? 'On' : 'Off'}`);
        ui.renderRequests();
    });

    ui.elements.songList.genreFilterContainer.addEventListener('click', e => {
        const target = e.target;
        if (target.classList.contains('filter-btn') || target.classList.contains('sub-filter-btn')) {
            const genre = target.dataset.genre;
            if (state.activeGenres.has(genre)) state.activeGenres.delete(genre);
            else state.activeGenres.add(genre);
            target.classList.toggle('active');
            processAndRenderSongList();
        } else if (target.classList.contains('sub-genre-toggle')) {
            const parentGenre = target.dataset.parentGenre;
            const container = document.getElementById(`sub-genres-${parentGenre.replace(/\s+/g, '-')}`);
            container.classList.toggle('show');
            target.classList.toggle('expanded');
            target.textContent = target.classList.contains('expanded') ? '▴' : '▾';
        }
    });
    
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
        state.activeGenres.clear();
        ui.elements.songList.searchBox.value = '';
        ui.renderGenreFilters();
        processAndRenderSongList();
        ui.showToast("Filters cleared");
    });

    document.getElementById('userAvatarDisplay').addEventListener('click', ui.showAvatarModal);
    document.getElementById('avatarModal').addEventListener('click', (e) => {
        if (e.target.classList.contains('avatar-option')) {
            const newAvatar = e.target.textContent;
            state.setUserAvatar(newAvatar);
            localStorage.setItem('userAvatar', newAvatar);
            document.getElementById('userAvatarDisplay').textContent = newAvatar;
            ui.showToast(`Avatar changed to ${newAvatar}`);
            ui.hideAvatarModal();
        } else if (!e.target.closest('.modal-content')) {
            ui.hideAvatarModal();
        }
    });
    
    document.getElementById('clearByUserBtn').addEventListener('click', ui.showClearUserModal);
    document.getElementById('clearUserModal').addEventListener('click', (e) => {
        if (e.target.classList.contains('avatar-option')) {
            const avatarToClear = e.target.textContent;
            websocket.send({ action: 'clearByUser', userAvatar: avatarToClear });
            ui.showToast(`Cleared songs requested by ${avatarToClear}`);
            ui.hideClearUserModal();
        } else if (!e.target.closest('.modal-content')) {
            ui.hideClearUserModal();
        }
    });

    ui.elements.songList.unhideBtn.addEventListener('click', () => {
        if (state.hiddenSongs.size > 0) {
            ui.showToast(`${state.hiddenSongs.size} song(s) have been unhidden.`);
            state.hiddenSongs.clear();
            state.saveHiddenSongs();
            renderAll();
        } else {
            ui.showToast('No songs are currently hidden.');
        }
    });

    document.getElementById('addFavoritesBtn').addEventListener('click', () => {
        const favSongs = state.allSongs.filter(s => state.favorites.has(s.Name) && !state.currentRequests.some(r => r.Name === s.Name));
        if (favSongs.length > 0) {
            const favsWithAvatar = favSongs.map(s => ({ ...s, userAvatar: state.userAvatar }));
            websocket.send({ action: 'addMultiple', songs: favsWithAvatar });
        } else {
            ui.showToast('All your favorites are already in the queue!');
        }
    });

    document.getElementById('requestRandomBtn').addEventListener('click', () => {
        if (state.shuffledDeck.length === 0) {
            const available = state.allSongs.filter(s => !state.hiddenSongs.has(s.Name));
            state.setShuffledDeck(available.sort(() => 0.5 - Math.random()));
        }
        const availableInDeck = state.shuffledDeck.filter(s => !state.currentRequests.some(r => r.Name === s.Name));
        const songsToRequest = availableInDeck.slice(0, 10).map(s => ({...s, isRandom: true, userAvatar: '🎲' }));
        if (songsToRequest.length > 0) {
            const requestedNames = new Set(songsToRequest.map(s => s.Name));
            state.setShuffledDeck(state.shuffledDeck.filter(s => !requestedNames.has(s.Name)));
            websocket.send({ action: 'addMultiple', songs: songsToRequest });
        } else {
            ui.showToast('No more new random songs to add!');
            state.setShuffledDeck([]);
        }
    });
    
    document.getElementById('playNextBtn').addEventListener('click', () => {
        if (state.currentRequests.length > 0) {
            const songToPlay = state.currentRequests[0];
            websocket.send({ action: 'nowPlaying', songName: songToPlay.Name });
            websocket.send({ action: 'forceRemove', songName: songToPlay.Name });
        } else {
            ui.showToast("The queue is empty!");
        }
    });

    ui.elements.upNext.clearFavs.addEventListener('click', () => {
        const favNamesInQueue = state.currentRequests.filter(r => state.favorites.has(r.Name)).map(r => r.Name);
        if (favNamesInQueue.length > 0) websocket.send({ action: 'removeMultiple', songNames: favNamesInQueue });
    });
    ui.elements.upNext.clearAll.addEventListener('click', () => websocket.send({ action: 'clearAll' }));
    ui.elements.upNext.clearRandom.addEventListener('click', () => websocket.send({ action: 'clearRandom' }));

    ui.elements.songList.searchBox.addEventListener("input", (e) => {
        const query = e.target.value;
        const url = new URL(window.location);
        if (query) {
            url.searchParams.set('search', query);
        } else {
            url.searchParams.delete('search');
        }
        history.pushState({}, '', url);
        processAndRenderSongList();
    });
    window.onscroll = () => ui.elements.global.backToTopBtn.style.display = (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) ? "block" : "none";
    ui.elements.global.backToTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    ui.elements.debug.copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(ui.elements.debug.log.textContent)
            .then(() => ui.showToast('Debug log copied to clipboard!'))
            .catch(err => {
                log('error', 'Failed to copy debug log:', err);
                ui.showToast('Could not copy log.');
            });
    });

    Sortable.create(ui.elements.upNext.list, { animation: 150, onEnd: (evt) => {
        const newOrder = Array.from(evt.to.children).map(li => li.dataset.songName);
        websocket.send({ action: 'reorder', songs: newOrder });
    }});
}

// --- Initial Load ---
function processGenreData(songs) {
    const genreMap = {
        'Alternative Rock': 'Alternative', 'Indie Rock': 'Alternative', 'Grunge': 'Alternative', 'Post-Punk Revival': 'Alternative', 'Britpop': 'Alternative', 'Experimental Rock': 'Alternative', 'Emo': 'Alternative',
        'Classic Rock': 'Rock', 'Hard Rock': 'Rock', 'Psychedelic Rock': 'Rock', 'Southern Rock': 'Rock', 'Garage Rock': 'Rock', 'Surf Rock': 'Rock', 'Folk Rock': 'Rock', 'Aor': 'Rock', 'Rockabilly': 'Rock', 'Stoner Rock': 'Rock', 'Progressive Rock': 'Rock',
        'Glam Metal': 'Metal', 'Gothic Metal': 'Metal', 'Heavy Metal': 'Metal', 'Nu-Metal': 'Metal', 'Power Metal': 'Metal', 'Doom Metal': 'Metal', 'Alternative Metal': 'Metal', 'Industrial Metal': 'Metal', 'Death Metal': 'Metal', 'Groove Metal': 'Metal', 'Melodic Death Metal': 'Metal',
        'Pop Rock': 'Pop', 'Synth-Pop': 'Pop', 'Dance-Pop': 'Pop', 'Power Pop': 'Pop', 'Art Pop': 'Pop', 'Indie Pop': 'Pop',
        'Punk Rock': 'Punk', 'Hardcore Punk': 'Punk',
        'R&B/Soul': 'R&B', 'Funk': 'R&B', 'Disco': 'R&B', 'Soul': 'R&B',
        'Hip Hop': 'Hip Hop',
        'Electronic': 'Electronic', 'Techno': 'Electronic', 'House': 'Electronic', 'Trip-Hop': 'Electronic', 'Electro': 'Electronic', 'Synthpop': 'Electronic', 'Dance': 'Electronic',
        'Blues Rock': 'Blues', 'Texas Blues': 'Blues'
    };
    
    songs.forEach(song => {
        song.subGenre = song.Genre || 'Unknown';
        song.parentGenre = genreMap[song.subGenre] || song.subGenre;
    });

    const genreCounts = {};
    songs.forEach(song => {
        if (!genreCounts[song.parentGenre]) genreCounts[song.parentGenre] = { name: song.parentGenre, count: 0, subGenres: {} };
        genreCounts[song.parentGenre].count++;
        if (song.parentGenre !== song.subGenre) {
            if (!genreCounts[song.parentGenre].subGenres[song.subGenre]) genreCounts[song.parentGenre].subGenres[song.subGenre] = { name: song.subGenre, count: 0 };
            genreCounts[song.parentGenre].subGenres[song.subGenre].count++;
        }
    });

    const sortedGenres = Object.values(genreCounts).sort((a, b) => b.count - a.count);
    sortedGenres.forEach(genre => genre.subGenres = Object.values(genre.subGenres).sort((a, b) => b.count - a.count));
    
    const topGenres = sortedGenres.slice(0, 9);
    const otherGenres = sortedGenres.slice(9);

    if (otherGenres.length > 0) {
        const otherCount = otherGenres.reduce((sum, genre) => sum + genre.count, 0);
        const otherSubGenres = otherGenres.flatMap(g => g.subGenres.length > 0 ? g.subGenres : [{ name: g.name, count: g.count }]);
        topGenres.push({ name: 'Other', count: otherCount, subGenres: otherSubGenres.sort((a, b) => b.count - a.count) });
    }
    return topGenres;
}

function initializeApp(data) {
    log('init', 'Initializing application...');
    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === 'true';
    state.setAdmin(isAdmin);
    if (isAdmin) {
        document.body.classList.add('is-admin');
        log('info', 'Admin mode enabled.');
    }
    
    const avatars = ['🐰', '🐼', '🐨', '🐧', '🦅', '🦉', '🦄', '🦋', '🐞', '🐬', '🦓', '🦙', '🦌', '🦢', '🦩', '🦦', '🦔'];
    state.setAvatars(avatars);
    log('init', `Loaded ${avatars.length} possible avatars.`);
    let savedAvatar = localStorage.getItem('userAvatar');
    if (!savedAvatar || !avatars.includes(savedAvatar)) {
        savedAvatar = avatars[Math.floor(Math.random() * avatars.length)];
        localStorage.setItem('userAvatar', savedAvatar);
    }
    state.setUserAvatar(savedAvatar);
    document.getElementById('userAvatarDisplay').textContent = savedAvatar;
    log('init', `User avatar set to: ${savedAvatar}`);

    const cleanName = (str) => str ? str.replace(/\s*\(.*?\)\s*/g, ' ').trim() : '';
    const uniqueSongs = [];
    const seen = new Set();

    log('init', 'Processing and cleaning song data...');
    data.forEach(song => {
        song.Genre = cleanGenreName(song.Genre);
        const cleanedName = cleanName(song.Name);
        const cleanedArtist = cleanName(song.Artist);
        if (!cleanedName || !cleanedArtist) return;
        const identifier = `${cleanedName}|${cleanedArtist}`.toLowerCase();
        if (!seen.has(identifier)) {
            seen.add(identifier);
            uniqueSongs.push({ ...song, Name: cleanedName, Artist: cleanedArtist });
        }
    });
    log('init', `Found ${uniqueSongs.length} unique songs.`);

    const genreData = processGenreData(uniqueSongs);
    state.setGenreFilterData(genreData);
    state.setAllSongs(uniqueSongs);
    log('init', 'Processed genre data and set initial state.');

    ui.elements.upNext.songCount.textContent = `${uniqueSongs.length} songs total`;
    if (ui.elements.upNext.favSortButton) {
        ui.elements.upNext.favSortButton.classList.toggle('active', state.upNextFavoritesTop);
    }
    const timeSortButton = document.querySelector(`#upNextTimeSortButtons .sort-btn[data-sort="${state.upNextTimeSort}"]`);
    if (timeSortButton) {
        timeSortButton.classList.add('active');
    }
    
    const lastTab = localStorage.getItem('lastActiveTab');
    if (lastTab) {
        const tabButton = document.querySelector(`.tab-button[data-tab="${lastTab}"]`);
        if (tabButton) tabButton.click();
    }

    const searchQuery = urlParams.get('search');
    if (searchQuery) {
        ui.elements.songList.searchBox.value = searchQuery;
    }

    websocket.init(
        (requests) => { // onStateChange
            log('websocket', 'Received state update:', requests);
            const safeRequests = Array.isArray(requests) ? requests : [];
            state.setCurrentRequests(safeRequests);
            renderAll();
        },
        (message) => { // onToast
            log('websocket', 'Received toast message:', message);
            ui.showToast(message);
        }
    );

    setupEventListeners();
    ui.renderGenreFilters();
    renderAll();
    log('init', 'Application initialized and first render complete.');
}

// --- App Start ---
ui.renderSkeletons();
fetch("songs.json")
    .then(res => res.json())
    .then(initializeApp)
    .catch(err => {
        console.error("Failed to load songs.json", err);
        log('error', 'Failed to load or initialize app from songs.json', err);
        document.getElementById('songListContainer').innerHTML = '<p style="color: red; text-align: center;">Error: Could not load song list. Please check the console.</p>';
    });