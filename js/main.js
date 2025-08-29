let ws;
let currentUser = { id: '', name: '', avatar: '' };
let isAdmin = false;
let songs = [];
let queue = [];
let history = [];
let queuedSongIds = new Set(); // Track queued song IDs for UI feedback
let cleanedSongsCache = null; // Cache for cleaned and deduplicated songs
let genreDataCache = null; // Cache for genre analysis data
let artistImageCache = {}; // Cache for artist images from server
let pendingArtistRequests = new Set(); // Track pending artist image requests

// Pagination state for infinite scroll
let currentPage = 0;
const SONGS_PER_PAGE = 50;
let isLoadingMore = false;
let hasMoreSongs = true;
let currentSearchQuery = '';
let currentActiveGenres = ['all'];
let currentActiveInstruments = [];

// Optimized feather replacement to batch multiple calls
function scheduleFeatherReplace() {
    if (window.featherReplaceTimeout) {
        clearTimeout(window.featherReplaceTimeout);
    }
    window.featherReplaceTimeout = setTimeout(() => {
        feather.replace();
        window.featherReplaceTimeout = null;
    }, 16); // ~60fps for smooth performance
}

// Check if admin
const urlParams = new URLSearchParams(window.location.search);
isAdmin = urlParams.has('admin');

document.addEventListener('DOMContentLoaded', () => {
    // Defer feather initialization to reduce initial load time
    requestAnimationFrame(() => {
        feather.replace();
    });
    initUser();
    document.body.setAttribute('data-admin', isAdmin);
    connectWebSocket();
    setupAdminSection();
    setupEventListeners();
    setupInfiniteScroll();
});

function initUser() {
    currentUser.id = localStorage.getItem('userId') || generateUUID();
    currentUser.name = localStorage.getItem('userName') || '';
    currentUser.avatar = localStorage.getItem('userAvatar') || getRandomAvatar();
    localStorage.setItem('userId', currentUser.id);
    localStorage.setItem('userAvatar', currentUser.avatar);
    updateUserDisplay();
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getRandomAvatar() {
    const avatars = ['🐰', '🐼', '🐨', '🐧', '🦅', '🦉', '🦄', '🦋', '🐞', '🐬', '🦓', '🦙', '🦌', '🦢', '🦩', '🦦', '🦔'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

function updateUserDisplay() {
    const userBtn = document.getElementById('user-account');
    if (userBtn) {
        userBtn.innerHTML = `${currentUser.avatar}`;
        userBtn.style.fontSize = '24px';
        userBtn.style.cursor = 'pointer';
        userBtn.title = 'Change avatar and name';
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host || 'localhost:8766'}`;

    try {
        ws = new WebSocket(wsUrl);
    } catch (error) {
        console.error('WebSocket connection error:', error);
        showToast('Connection failed. Retrying...');
        setTimeout(connectWebSocket, 2000);
        return;
    }

    ws.onopen = () => {
        console.log('WebSocket connected successfully');
        showToast('Connected to server');

        sendWebSocketMessage({
            action: 'join',
            user_id: currentUser.id,
            is_admin: isAdmin,
            user_name: currentUser.name,
            user_avatar: currentUser.avatar
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.action) {
                case 'state':
                    updateState(data.data);
                    reconnectAttempts = 0; // Reset reconnection attempts on successful message
                    break;

                case 'error':
                    console.error('Server error:', data.message);
                    showToast(`Server Error: ${data.message}`);
                    break;

                case 'server_shutdown':
                    console.log('Server shutdown notification received');
                    showToast('Server is shutting down gracefully...');
                    break;

                case 'song_requested':
                    // Handle real-time song request notification
                    if (data.user_id !== currentUser.id) {
                        showToast(`${data.user_name || 'Someone'} requested a song`);
                    }
                    break;

                case 'song_removed':
                    // Handle real-time song removal notification
                    if (data.user_id !== currentUser.id) {
                        showToast(`${data.user_name || 'Someone'} removed a song from queue`);
                    }
                    break;

                case 'vote_updated':
                    // Handle real-time vote updates
                    updateQueueItem(data.queue_id, data.upvotes, data.downvotes);
                    break;

                case 'artist_images':
                    // Handle artist images response
                    handleArtistImagesResponse(data);
                    break;

                default:
                    console.log('Unknown WebSocket action:', data.action);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            showToast('Error processing server message');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showToast('Connection error occurred');
    };

    ws.onclose = (event) => {
        console.log(`WebSocket closed: code ${event.code}, reason: ${event.reason}`);

        if (event.code !== 1001) { // Not a normal closure
            showToast('Connection lost. Reconnecting...');
        }

        // Reconnect after delay with exponential backoff
        const reconnectDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;

        setTimeout(() => {
            if (reconnectAttempts < maxReconnectAttempts) {
                connectWebSocket();
            } else {
                showToast('Unable to reconnect. Please refresh the page.');
                reconnectAttempts = 0;
            }
        }, reconnectDelay);
    };
}

let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function sendWebSocketMessage(message, successMessage = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server. Message not sent.');
        return false;
    }

    try {
        ws.send(JSON.stringify(message));
        if (successMessage) {
            showToast(successMessage);
        }
        return true;
    } catch (error) {
        console.error('Error sending WebSocket message:', error);
        showToast('Failed to send message to server');
        return false;
    }
}

function updateState(state) {
    const newSongs = state.songs || [];
    const newQueue = state.queue || [];
    const newHistory = state.history || [];

    // Check if songs changed to invalidate caches
    if (JSON.stringify(songs) !== JSON.stringify(newSongs)) {
        cleanedSongsCache = null; // Clear cleaned songs cache
        genreDataCache = null; // Clear genre data cache

        // Reset pagination state when songs change
        currentPage = 0;
        isLoadingMore = false;
        hasMoreSongs = true;
        currentSearchQuery = '';
        currentActiveGenres = ['all'];
    }

    songs = newSongs;
    queue = newQueue;
    history = newHistory;

    // Update queued song IDs for UI feedback
    queuedSongIds.clear();
    queue.forEach(item => {
        // Try to match by song_id first, then fall back to name/artist matching
        if (item.song_id) {
            queuedSongIds.add(item.song_id);
        } else if (item.name && item.artist) {
            // Find the corresponding song in the songs array and use its ID
            const matchingSong = songs.find(song =>
                song.name === item.name && song.artist === item.artist
            );
            if (matchingSong) {
                queuedSongIds.add(matchingSong.id);
            }
        }
    });

    renderSongs();
    renderQueue();
    renderHistory();
    updateGenreFilters(); // Update dynamic genre filters
}

function setupAdminSection() {
    const adminSection = document.getElementById('admin-section');
    if (isAdmin) {
        adminSection.style.display = 'block';
        const uploadBtn = document.getElementById('upload-btn');
        const uploadInput = document.getElementById('song-upload');

        uploadBtn.addEventListener('click', () => {
            const file = uploadInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const songsData = JSON.parse(e.target.result);
                        sendWebSocketMessage({
                            action: 'upload_songs',
                            songs: songsData
                        }, 'Songs uploaded successfully!');
                    } catch (err) {
                        console.error('Error parsing JSON file:', err);
                        showToast('Error parsing JSON file');
                    }
                };
                reader.readAsText(file);
            }
        });
    }
}

function setupEventListeners() {
    // User account modal
    const userBtn = document.getElementById('user-account');
    userBtn.addEventListener('click', showUserModal);

    // Modal controls
    const modal = document.getElementById('user-modal');
    const saveBtn = document.getElementById('save-user-settings');
    const cancelBtn = document.getElementById('cancel-user-settings');
    const avatarOptions = document.querySelectorAll('.avatar-option');

    saveBtn.addEventListener('click', saveUserSettings);
    cancelBtn.addEventListener('click', () => modal.style.display = 'none');

    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            avatarOptions.forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
        });
    });

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });



    // Sorting controls
    document.getElementById('sort-upvotes').addEventListener('click', () => sortQueue('upvotes'));
    document.getElementById('sort-oldest').addEventListener('click', () => sortQueue('oldest'));
    document.getElementById('sort-newest').addEventListener('click', () => sortQueue('newest'));
    document.getElementById('sort-random').addEventListener('click', () => sortQueue('random'));
    document.getElementById('remove-all').addEventListener('click', () => {
        const queueCount = queue.length;
        if (confirm(`Remove all ${queueCount} songs from the queue? This action cannot be undone.`)) {
            sendWebSocketMessage({ action: 'remove_all' }, 'All songs removed from queue');
        }
    });

    // Dynamic event listeners
    document.addEventListener('click', (e) => {
        if (e.target.closest('.request-btn')) {
            const btn = e.target.closest('.request-btn');
            const songId = btn.dataset.songId;
            const songCard = btn.closest('.song-card');

            if (songId && ws && ws.readyState === WebSocket.OPEN) {
                if (btn.classList.contains('queued')) {
                    // Un-request the song - immediately update UI and send message
                    queuedSongIds.delete(songId);
                    songCard.classList.remove('queued');
                    btn.classList.remove('queued');
                    btn.innerHTML = '<i data-feather="plus"></i>';
                    btn.disabled = false;
                    btn.setAttribute('aria-label', 'Add to queue');
                    const tooltipText = btn.nextElementSibling;
                    if (tooltipText) tooltipText.textContent = 'Click to add to queue';
                    scheduleFeatherReplace();

                    // Find the queue item and send remove request
                    const queueItem = queue.find(item =>
                        (item.song_id === songId || (item.name === song.name && item.artist === song.artist)) &&
                        item.user_id === currentUser.id
                    );
                    if (queueItem) {
                        sendWebSocketMessage({
                            action: 'remove_song',
                            queue_id: queueItem.id
                        });
                    }
                    showToast('Song removed from queue');
                } else {
                    // Request the song
                    // Immediately update UI for better feedback
                    queuedSongIds.add(songId);
                    songCard.classList.add('queued');
                    btn.classList.add('queued');
                    btn.innerHTML = '<i data-feather="check"></i>';
                    btn.disabled = true;
                    scheduleFeatherReplace();

                    sendWebSocketMessage({
                        action: 'request_song',
                        song_id: songId
                    }, 'Song requested!');
                }
            } else {
                showToast('Not connected to server. Please wait...');
            }
        }

        if (e.target.closest('.vote-btn')) {
            const btn = e.target.closest('.vote-btn');
            const queueId = btn.dataset.queueId;
            const voteType = btn.classList.contains('upvote') ? 'up' : 'down';
            sendWebSocketMessage({
                action: 'vote',
                queue_id: queueId,
                vote_type: voteType
            });
        }

        if (e.target.closest('.remove-btn')) {
            const btn = e.target.closest('.remove-btn');
            const queueId = btn.dataset.queueId;
            sendWebSocketMessage({
                action: 'remove_song',
                queue_id: queueId
            }, 'Song removed from queue');
        }

        if (e.target.closest('#mark-played')) {
            if (queue.length > 0) {
                const currentSong = queue[0];
                const songTitle = currentSong.name || 'Unknown Song';
                if (confirm(`Mark "${songTitle}" as played? This will move it to the history.`)) {
                    sendWebSocketMessage({
                        action: 'mark_played',
                        queue_id: currentSong.id
                    }, 'Song marked as played');
                }
            }
        }
    });
}

function setupInfiniteScroll() {
    const songList = document.getElementById('song-list');
    let scrollTimeout;

    function checkScroll() {
        if (scrollTimeout) clearTimeout(scrollTimeout);

        scrollTimeout = setTimeout(() => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;

            // Load more when user is within 200px of the bottom
            // Account for sticky footer by subtracting footer height
            const footerHeight = 80; // Approximate footer height
            if (documentHeight - scrollTop - windowHeight < 200 + footerHeight) {
                loadMoreSongs();
            }
        }, 100); // Debounce scroll events
    }

    window.addEventListener('scroll', checkScroll, { passive: true });

    // Handle resize events to ensure proper infinite scroll behavior
    window.addEventListener('resize', () => {
        // Trigger scroll check on resize to handle dynamic viewport changes
        setTimeout(checkScroll, 150);
    }, { passive: true });
}

function sortQueue(sortType) {
    // Update active button state
    const sortingButtons = document.querySelectorAll('.sorting-controls button');
    sortingButtons.forEach(button => {
        button.classList.remove('active');
    });

    // Add active class to the clicked button
    const clickedButton = document.getElementById(`sort-${sortType}`);
    if (clickedButton) {
        clickedButton.classList.add('active');
    }

    sendWebSocketMessage({
        action: 'sort_queue',
        sort_type: sortType,
        exclude_currently_playing: true // Only sort "up next" songs, not currently playing
    }, 'Queue sorted successfully');
}

// Set default sorting to upvotes on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set upvotes as default active sorting
    const upvotesButton = document.getElementById('sort-upvotes');
    if (upvotesButton) {
        upvotesButton.classList.add('active');
    }
});

function showUserModal() {
    const modal = document.getElementById('user-modal');
    const nameInput = document.getElementById('user-name-input');
    const avatarOptions = document.querySelectorAll('.avatar-option');

    // Set current values
    nameInput.value = currentUser.name;

    // Reset avatar selection
    avatarOptions.forEach(option => {
        option.classList.remove('selected');
        if (option.textContent === currentUser.avatar) {
            option.classList.add('selected');
        }
    });

    modal.style.display = 'flex';

    setTimeout(() => {
        nameInput.focus();
    }, 100);
}

function saveUserSettings() {
    const modal = document.getElementById('user-modal');
    const nameInput = document.getElementById('user-name-input');
    const selectedAvatar = document.querySelector('.avatar-option.selected');

    if (selectedAvatar) {
        const newName = nameInput.value.trim();
        const newAvatar = selectedAvatar.textContent;

        currentUser.name = newName;
        currentUser.avatar = newAvatar;

        localStorage.setItem('userName', newName);
        localStorage.setItem('userAvatar', newAvatar);

        updateUserDisplay();
        modal.style.display = 'none';

        // Update server with new user info
        sendWebSocketMessage({
            action: 'join',
            user_id: currentUser.id,
            is_admin: isAdmin,
            user_name: currentUser.name,
            user_avatar: currentUser.avatar
        });

        showToast('Profile updated!');
    }
}

function cleanSongTitle(title) {
    if (!title) return '';
    // Remove content within parentheses and brackets
    title = title.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '');
    // Trim whitespace
    title = title.trim();
    return title;
}

function cleanArtistName(artist) {
    if (!artist) return '';
    // Remove content within parentheses and brackets
    artist = artist.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '');
    // Trim whitespace
    artist = artist.trim();
    return artist;
}

function deduplicateSongs(songsArray) {
    const seen = new Set();
    const deduplicated = [];

    songsArray.forEach(song => {
        // Create normalized key for deduplication
        const cleanTitle = cleanSongTitle(song.name).toLowerCase();
        const cleanArtist = cleanArtistName(song.artist).toLowerCase();
        const key = `${cleanTitle}|${cleanArtist}`;

        if (!seen.has(key)) {
            seen.add(key);
            // Apply cleaning to the song object
            song.cleanedName = cleanSongTitle(song.name);
            song.cleanedArtist = cleanArtistName(song.artist);
            deduplicated.push(song);
        }
    });

    return deduplicated;
}

function renderSongs(append = false) {
    const songList = document.getElementById('song-list');
    const songGrid = songList.querySelector('.song-grid');
    const headerInfo = document.getElementById('header-song-count');

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();

    if (songs.length === 0) {
        songGrid.innerHTML = `
            <div class="no-songs-message">
                <h3>No songs available</h3>
                <p>${isAdmin ? 'Upload a songs.json file using the admin section above.' : 'Ask the host to upload some songs!'}</p>
            </div>
        `;
        if (headerInfo) headerInfo.textContent = '';
        cleanedSongsCache = null; // Clear cache
        return;
    }

    // Use cache or create cleaned songs
    if (!cleanedSongsCache) {
        cleanedSongsCache = deduplicateSongs([...songs]);
    }
    const cleanedSongs = cleanedSongsCache;

    // Filter songs based on current search and genre filters
    let filteredSongs = filterSongsByCriteria(cleanedSongs);

    // Update pagination state
    const totalFilteredSongs = filteredSongs.length;
    const startIndex = append ? currentPage * SONGS_PER_PAGE : 0;
    const endIndex = Math.min(startIndex + SONGS_PER_PAGE, totalFilteredSongs);
    const songsToRender = filteredSongs.slice(startIndex, endIndex);

    // Update loading state
    hasMoreSongs = endIndex < totalFilteredSongs;
    isLoadingMore = false;

    if (!append) {
        // Clear existing content for fresh render
        songGrid.innerHTML = '';
        currentPage = 0;
    }

    if (songsToRender.length === 0 && !append) {
        songGrid.innerHTML = `
            <div class="no-songs-message">
                <h3>No songs match your search</h3>
                <p>Try adjusting your search terms or genre filters.</p>
            </div>
        `;
    } else {
        // Create song cards for current page
        songsToRender.forEach(song => {
            const isQueued = queuedSongIds.has(song.id);
            const songCard = document.createElement('div');
            songCard.className = `song-card${isQueued ? ' queued' : ''}`;
            songCard.setAttribute('data-genre', (song.genre || '').trim());
            songCard.setAttribute('data-song-id', song.id);

            songCard.innerHTML = `
                <div class="song-card-content">
                    ${getArtistImage(song.cleanedArtist).startsWith('http') ?
                        `<img src="${getArtistImage(song.cleanedArtist)}" alt="Artist Image">` :
                        `<div class="artist-initial">${getArtistImage(song.cleanedArtist)}</div>`
                    }
                    <div class="song-info">
                        <strong title="${song.name}">${song.cleanedName}</strong>
                        <p title="${song.artist}">${song.cleanedArtist}</p>
                        <small>${formatDuration(song.songlength)}</small>
                    </div>
                </div>
                <div class="tooltip">
                    <button class="action-button request-btn ${isQueued ? 'queued' : ''}" data-song-id="${song.id}" ${isQueued ? 'disabled' : ''}>
                        ${isQueued ? '<span>Queued</span> <i data-feather="check"></i>' : '<i data-feather="plus"></i>'}
                    </button>
                </div>
            `;
            fragment.appendChild(songCard);
        });

        songGrid.appendChild(fragment);
    }

    // Update header with song count
    if (headerInfo) {
        const displayCount = append ? songGrid.children.length : songsToRender.length;
        headerInfo.textContent = `Showing ${displayCount} of ${totalFilteredSongs} songs`;
    }

    // Defer feather replacement for better performance
    scheduleFeatherReplace();
}

function filterSongsByInstrumentation(song) {
    if (currentActiveInstruments.length === 0) {
        return true; // No instrument filters active
    }

    // Check if song has instruments data
    if (!song.instruments) {
        return false;
    }

    // Parse instruments string (e.g., "1,Yes,Yes,Solo")
    const instruments = song.instruments.split(',');

    // Check each active instrument filter
    return currentActiveInstruments.every(instrument => {
        switch (instrument) {
            case 'guitar':
                return instruments[0] === '1' || instruments[0] === '2';

            case 'bass':
                return instruments[1] === 'Yes';

            case 'drums':
                return instruments[2] === 'Yes';

            case 'vocals':
                return instruments[3] === 'Solo' || instruments[3] === 'Harmony';

            case 'keys':
                // Leave non-functional for now as per specs
                return true;

            default:
                return true;
        }
    });
}

function filterSongsByCriteria(songsArray) {
    return songsArray.filter(song => {
        const name = song.cleanedName.toLowerCase();
        const artist = song.cleanedArtist.toLowerCase();
        const genre = (song.genre || '').toLowerCase();

        const matchesSearch = !currentSearchQuery ||
            name.includes(currentSearchQuery) ||
            artist.includes(currentSearchQuery) ||
            genre.includes(currentSearchQuery);

        let matchesGenre = currentActiveGenres.includes('all');

        if (!matchesGenre) {
            const songGenre = (song.genre || '').toLowerCase().trim();
            matchesGenre = currentActiveGenres.some(activeGenre => {
                if (activeGenre === 'other') {
                    const genreData = window.getGenreData ? window.getGenreData(songs) : { genres: [] };
                    const availableGenres = genreData.genres.filter(g => g !== 'All' && g !== 'Other');
                    return !availableGenres.some(availableGenre =>
                        songGenre.includes(availableGenre.toLowerCase())
                    );
                } else {
                    return songGenre === activeGenre;
                }
            });
        }

        const matchesInstruments = filterSongsByInstrumentation(song);

        return matchesSearch && matchesGenre && matchesInstruments;
    });
}

function loadMoreSongs() {
    if (isLoadingMore || !hasMoreSongs) return;

    isLoadingMore = true;
    currentPage++;
    renderSongs(true);
}

function setupQueueDragAndDrop() {
    const draggableItems = document.querySelectorAll('.draggable-queue-item');

    draggableItems.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.target.getAttribute('data-queue-id'));
    e.target.classList.add('dragging');

    // Add visual feedback to all items
    document.querySelectorAll('.draggable-queue-item').forEach(item => {
        if (item !== e.target) {
            item.classList.add('drag-target');
        }
    });
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');

    // Remove visual feedback from all items
    document.querySelectorAll('.draggable-queue-item').forEach(item => {
        item.classList.remove('drag-target', 'drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    const target = e.target.closest('.draggable-queue-item');
    if (target && !target.classList.contains('dragging')) {
        target.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    e.preventDefault();
    const target = e.target.closest('.draggable-queue-item');
    if (target) {
        target.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();

    const draggedElement = document.querySelector('.dragging');
    const targetElement = e.target.closest('.draggable-queue-item');

    // Clean up visual feedback
    document.querySelectorAll('.draggable-queue-item').forEach(item => {
        item.classList.remove('drag-target', 'drag-over');
    });

    if (!draggedElement || !targetElement || draggedElement === targetElement) {
        return;
    }

    const draggedId = draggedElement.getAttribute('data-queue-id');
    const targetId = targetElement.getAttribute('data-queue-id');

    // Send reorder request to server
    sendWebSocketMessage({
        action: 'reorder_queue',
        dragged_id: draggedId,
        target_id: targetId
    }, 'Queue reordered successfully');
}

function renderQueue() {
    const nowPlaying = document.getElementById('now-playing');
    const upNextList = document.getElementById('up-next-content').querySelector('ul');
    const upNextHeader = document.querySelector('#up-next h3');

    if (queue.length > 0) {
        const nowPlayingSong = queue[0];
        const artistImage = getArtistImage(cleanArtistName(nowPlayingSong.artist));
        nowPlaying.innerHTML = `
            ${artistImage.startsWith('http') ?
                `<img src="${artistImage}" alt="Artist Image">` :
                `<div class="artist-initial artist-initial-large">${artistImage}</div>`
            }
            <div class="song-info">
                <h4>${nowPlayingSong.name}</h4>
                <p>${nowPlayingSong.artist}</p>
            </div>
            <button class="play-button"><i data-feather="play"></i></button>
            ${isAdmin ? `<button id="mark-played">Mark as Played</button>` : ''}
            <div class="progress-bar-container">
                <div class="progress-bar"></div>
            </div>
        `;

        // Update "Up Next" header with dynamic count
        const upNextCount = queue.length - 1;
        if (upNextHeader) {
            upNextHeader.textContent = `Up Next (${upNextCount})`;
        }

        // Up Next
        upNextList.innerHTML = '';
        if (upNextCount > 0) {
            queue.slice(1).forEach((item, index) => {
                const li = document.createElement('li');
                li.className = 'queue-item';
                li.setAttribute('data-queue-id', item.id);
                li.setAttribute('data-queue-position', index + 1); // Position in queue (excluding now playing)
                if (isAdmin) {
                    li.setAttribute('draggable', 'true');
                    li.classList.add('draggable-queue-item');
                }
                const requesterDisplay = item.user_name ? `${item.user_avatar} ${item.user_name}` : item.user_avatar;
                const queueArtistImage = getArtistImage(cleanArtistName(item.artist));
                li.innerHTML = `
                    ${queueArtistImage.startsWith('http') ?
                        `<img src="${queueArtistImage}" alt="Artist Image">` :
                        `<div class="artist-initial">${queueArtistImage}</div>`
                    }
                    <div class="song-info">
                        <strong>${item.name}</strong>
                        <p>${item.artist}</p>
                        <small>Requested by: ${requesterDisplay}</small>
                    </div>
                    <div class="vote-buttons">
                        <button class="vote-btn upvote" data-queue-id="${item.id}" data-count="${item.upvotes}"><i data-feather="thumbs-up"></i></button>
                    </div>
                    ${isAdmin ? `<button class="remove-btn" data-queue-id="${item.id}"><i data-feather="x"></i></button>` : ''}
                `;
                upNextList.appendChild(li);
            });

            // Add drag and drop functionality for admins
            if (isAdmin) {
                setupQueueDragAndDrop();
            }
        } else {
            upNextList.innerHTML = '<li>No songs in queue</li>';
        }
    } else {
        nowPlaying.innerHTML = '<p>No song playing</p>';
        if (upNextHeader) {
            upNextHeader.textContent = 'Up Next (0)';
        }
        upNextList.innerHTML = '<li>No songs in queue</li>';
    }
    // Defer feather replacement for better performance
    scheduleFeatherReplace();
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';

    history.forEach(song => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <div class="song-info">
                <strong>${song.name}</strong>
                <p>${song.artist}</p>
            </div>
            <div class="tooltip">
                <button class="action-button request-btn" data-song-id="" aria-label="Request this song">
                    <i data-feather="plus"></i>
                </button>
            </div>
        `;
        historyList.appendChild(li);
    });
    // Defer feather replacement for better performance
    scheduleFeatherReplace();
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Get artist image or fallback to initial
function getArtistImage(artistName) {
    if (!artistName) return '?';

    // Check if we have a cached image URL
    const cached = artistImageCache[artistName];
    if (cached) {
        return cached.startsWith('http') ? cached : cached; // Return image URL or initial fallback
    }

    // If no cached value but not pending, request it
    if (!pendingArtistRequests.has(artistName)) {
        requestArtistImages([artistName]);
    }

    // Return initial fallback while waiting
    return artistName[0].toUpperCase();
}

// Request artist images from server
function requestArtistImages(artists) {
    if (!artists || artists.length === 0) return;

    // Filter out artists that are already cached or pending
    const uncachedArtists = artists.filter(artist =>
        !artistImageCache.hasOwnProperty(artist) && !pendingArtistRequests.has(artist)
    );

    if (uncachedArtists.length === 0) return;

    // Mark as pending
    uncachedArtists.forEach(artist => pendingArtistRequests.add(artist));

    // Send request to server
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendWebSocketMessage({
            action: 'lookup_artist_images',
            artists: uncachedArtists
        });
    } else {
        // If not connected, just use fallbacks
        uncachedArtists.forEach(artist => {
            artistImageCache[artist] = artist[0].toUpperCase();
            pendingArtistRequests.delete(artist);
        });
    }
}

// Handle artist images response from server
function handleArtistImagesResponse(data) {
    const { results } = data;

    if (results) {
        // Update cache with server results
        Object.entries(results).forEach(([artist, imageUrl]) => {
            artistImageCache[artist] = imageUrl;
            pendingArtistRequests.delete(artist);
        });
    }

    // Re-render UI with updated images
    if (songs.length > 0) {
        renderSongs();
    }
    if (queue.length > 0) {
        renderQueue();
    }
    if (history.length > 0) {
        renderHistory();
    }
}

// Genre grouping configuration
const GENRE_GROUPINGS = {
    'Rock': ['rock', 'classic rock', 'alternative rock', 'blues rock', 'hard rock', 'punk rock', 'indie rock', 'rock and roll', 'folk rock', 'pop rock', 'prog rock', 'post rock'],
    'Pop': ['pop', 'poprock', 'power pop', 'synthpop', 'electropop', 'pop punk', 'teen pop'],
    'Hip Hop': ['hip hop', 'rap', 'hip-hop', 'hiphop', 'trap', 'conscious hip hop', 'west coast rap'],
    'Electronic': ['electronic', 'dance', 'house', 'techno', 'trance', 'dubstep', 'electro', 'synthwave', 'ambient', 'idm'],
    'Jazz': ['jazz', 'bebop', 'cool jazz', 'free jazz', 'fusion', 'smooth jazz', 'jazz fusion'],
    'Classical': ['classical', 'orchestral', 'symphony', 'opera', 'chamber music', 'baroque', 'renaissance'],
    'R&B': ['r&b', 'rhythm and blues', 'soul', 'funk', 'neo-soul', 'contemporary r&b'],
    'Country': ['country', 'country rock', 'alt country', 'bluegrass', 'folk country'],
    'Blues': ['blues', 'delta blues', 'chicago blues', 'electric blues', 'acoustic blues'],
    'Reggae': ['reggae', 'dub', 'ska', 'rocksteady', 'dancehall'],
    'Folk': ['folk', 'indie folk', 'folk rock', 'acoustic', 'singer-songwriter'],
    'Metal': ['metal', 'heavy metal', 'death metal', 'black metal', 'thrash metal', 'power metal'],
    'Indie': ['indie', 'independent', 'indie pop', 'indie rock', 'indie folk', 'shoegaze'],
    'Punk': ['punk', 'punk rock', 'post punk', 'hardcore punk', 'emo'],
    'Alternative': ['alternative', 'alt rock', 'alternative rock', 'grunge', 'post grunge'],
    'World': ['world', 'world music', 'ethnic', 'traditional', 'international']
};

// Synonyms mapping for better grouping
const GENRE_SYNONYMS = {
    'hip hop': 'Hip Hop',
    'hip-hop': 'Hip Hop',
    'hiphop': 'Hip Hop',
    'rap': 'Hip Hop',
    'trap': 'Hip Hop',
    'r&b': 'R&B',
    'rhythm and blues': 'R&B',
    'indie': 'Indie',
    'independent': 'Indie',
    'rock': 'Rock',
    'classic rock': 'Rock',
    'alternative rock': 'Rock',
    'blues rock': 'Rock',
    'pop': 'Pop',
    'electronic': 'Electronic',
    'dance': 'Electronic',
    'jazz': 'Jazz',
    'classical': 'Classical',
    'country': 'Country',
    'blues': 'Blues',
    'reggae': 'Reggae',
    'folk': 'Folk',
    'metal': 'Metal',
    'heavy metal': 'Metal',
    'punk': 'Punk',
    'punk rock': 'Punk',
    'alternative': 'Alternative',
    'alt rock': 'Alternative',
    'world': 'World',
    'world music': 'World'
};

function normalizeGenre(genre) {
    if (!genre) return '';
    return genre.toLowerCase().trim();
}

// Expose functions globally for use in other scripts
window.getGenreGroup = function(genre) {
    const normalized = normalizeGenre(genre);

    // First check if it's a synonym
    if (GENRE_SYNONYMS[normalized]) {
        return GENRE_SYNONYMS[normalized];
    }

    // Then check if it matches any group
    for (const [group, genres] of Object.entries(GENRE_GROUPINGS)) {
        if (genres.includes(normalized)) {
            return group;
        }
    }

    // If no match, return the original genre (capitalized)
    return genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase();
};

window.getGenreData = getGenreData;

function extractGenresFromSongs(songsArray) {
    const genreCount = new Map();

    songsArray.forEach(song => {
        if (song.genre) {
            // Use the raw genre from the song, not grouped
            const rawGenre = song.genre.trim();
            if (rawGenre) {
                genreCount.set(rawGenre, (genreCount.get(rawGenre) || 0) + 1);
            }
        }
    });

    return genreCount;
}

function getTopGenres(songsArray, limit = 9) {
    const genreCount = extractGenresFromSongs(songsArray);

    // Convert to array and sort by count
    const sortedGenres = Array.from(genreCount.entries())
        .sort((a, b) => b[1] - a[1]);

    // Take top genres
    const topGenres = sortedGenres.slice(0, limit).map(([genre]) => genre);

    // Add "Other" if there are more genres
    if (sortedGenres.length > limit) {
        topGenres.push('Other');
    }

    return topGenres;
}

function getGenreData(songsArray) {
    if (!songsArray || songsArray.length === 0) {
        return { genres: [], genreCount: new Map() };
    }

    // Use cache if available and songs haven't changed
    if (genreDataCache && genreDataCache.songCount === songsArray.length) {
        return genreDataCache;
    }

    const genreCount = extractGenresFromSongs(songsArray);
    const genres = getTopGenres(songsArray);

    genreDataCache = {
        genres,
        genreCount,
        songCount: songsArray.length
    };

    return genreDataCache;
}

function updateQueueItem(queueId, upvotes, downvotes) {
    const queueItem = document.querySelector(`[data-queue-id="${queueId}"]`);
    if (queueItem) {
        const upvoteBtn = queueItem.querySelector('.upvote');

        if (upvoteBtn) upvoteBtn.setAttribute('data-count', upvotes || 0);
    }
}

function updateGenreFilters() {
    const genreFiltersContainer = document.querySelector('.genre-filters');
    if (!genreFiltersContainer) return;

    const genreData = getGenreData(songs);
    const genres = genreData.genres;

    // Clear existing filters except the "All" filter
    const allFilter = genreFiltersContainer.querySelector('#filter-all');
    genreFiltersContainer.innerHTML = '';
    genreFiltersContainer.appendChild(allFilter);

    // Add dynamic genre filters
    genres.forEach(genre => {
        if (genre === 'All') return; // Skip if it's already the All filter

        const button = document.createElement('button');
        button.id = `filter-${genre.toLowerCase().replace(/\s+/g, '')}`;
        button.textContent = genre;
        genreFiltersContainer.appendChild(button);
    });

    // Re-attach event listeners for the new filters
    setupGenreFilterListeners();
}

function setupGenreFilterListeners() {
    const genreFilters = document.querySelectorAll('.genre-filters button');
    const allFilter = document.getElementById('filter-all');

    genreFilters.forEach(button => {
        button.addEventListener('click', () => {
            const isAllButton = button.id === 'filter-all';

            if (isAllButton) {
                // If "All" is clicked, activate only "All" and deactivate others
                genreFilters.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            } else {
                // If any other filter is clicked, deactivate "All" and toggle the clicked filter
                allFilter.classList.remove('active');
                button.classList.toggle('active');

                // If no filters are active, activate "All"
                const activeFilters = document.querySelectorAll('.genre-filters button.active:not(#filter-all)');
                if (activeFilters.length === 0) {
                    allFilter.classList.add('active');
                }
            }

            const searchInput = document.querySelector('.search-bar input');
            if (searchInput) {
                filterSongs(searchInput.value.toLowerCase());
            }
        });
    });
}

function showToast(message) {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 3000);
}