import asyncio
import json
import sqlite3
import uuid
import os
import logging
import signal
import sys
from datetime import datetime

import re
import csv
import time
import asyncio

# Optional external API import - server will work without it
try:
    import aiohttp  # For external API calls
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    aiohttp = None
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('RhythmCrew')

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
    logger.info(f"Using websockets library version: {websockets.__version__}")
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("websockets library not available")

# Simple fallback HTTP server for testing
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

# Database setup
def init_db():
    conn = sqlite3.connect('rhythmcrew.db')
    c = conn.cursor()
    # Songs table
    c.execute('''CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY,
        name TEXT,
        artist TEXT,
        album TEXT,
        genre TEXT,
        charter TEXT,
        year INTEGER,
        songlength INTEGER
    )''')
    # Queue table
    c.execute('''CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY,
        song_id INTEGER,
        user_id TEXT,
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0,
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(song_id) REFERENCES songs(id)
    )''')
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        avatar TEXT
    )''')
    # History table
    c.execute('''CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        song_id INTEGER,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(song_id) REFERENCES songs(id)
    )''')
    conn.commit()
    conn.close()

init_db()

# Connected clients
clients = {}
admin_clients = set()

# Artist image cache to avoid repeated CSV lookups
artist_image_cache = {}
owner_lookup_cache = {}  # owner -> cleaned_artist mapping

def load_artist_database():
    """Load and cache the entire artist database at startup for fast lookups"""
    global owner_lookup_cache, artist_image_cache

    try:
        with open('Global Music Artists.csv', 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file)

            count = 0
            for row in reader:
                csv_artist = row.get('artist_name', '').strip()
                csv_image = row.get('artist_img', '').strip()

                if csv_artist and csv_image and csv_image.startswith('http'):
                    count += 1
                    # Store mapping from cleaned artist to possible matches
                    cleaned_artist = clean_artist_name(csv_artist)
                    if cleaned_artist not in owner_lookup_cache:
                        owner_lookup_cache[cleaned_artist] = []
                    owner_lookup_cache[cleaned_artist].append({
                        'original_artist': csv_artist,
                        'image': csv_image
                    })

                    # Cache the original name also for exact matches
                    artist_image_cache[csv_artist] = csv_image
                    artist_image_cache[cleaned_artist] = csv_image  # Also cache cleaned version for direct lookup

                    if count <= 5:  # Log first few entries for debugging
                        logger.debug(f"Loaded artist: '{csv_artist}' -> '{cleaned_artist}' -> {csv_image[:50]}...")

        logger.info(f"Preloaded {len(owner_lookup_cache)} artist entries from database ({count} valid images)")

        # Log some sample artifacts for debugging
        if owner_lookup_cache:
            sample_key = list(owner_lookup_cache.keys())[0]
            logger.debug(f"Sample lookup cache entry: '{sample_key}' -> {len(owner_lookup_cache[sample_key])} matches")

    except FileNotFoundError:
        logger.warning("Global Music Artists.csv file not found at startup")
    except Exception as e:
        logger.error(f"Error loading artist database at startup: {e}")

def test_artist_lookup():
    """Quick test function to verify artist lookup is working"""
    test_artists = ['Coldplay', 'Radiohead', 'Red Hot Chili Peppers']  # Known artists from CSV

    logging.info("=== TESTING ARTIST LOOKUP ===")
    logging.getLogger().setLevel(logging.DEBUG)

    result = lookup_artist_images(test_artists)

    for artist, image in result.items():
        if image.startswith('http'):
            logging.info(f"✓ {artist}: Found image")
        else:
            logging.warning(f"✗ {artist}: No image found, using initial '{image}'")

    logging.getLogger().setLevel(logging.INFO)
    logging.info("=== TEST COMPLETE ===")

def clean_artist_name(artist):
    """
    Clean artist name for consistent matching.
    Remove content within parentheses and brackets, trim whitespace.
    Prioritize primary artist by splitting featuring/feat patterns.
    """
    if not artist:
        return ''

    original_artist = artist

    # Split on featuring/feat patterns and take primary artist
    # This handles cases like "Artist A featuring Artist B" -> "Artist A"
    patterns = [
        r'\s+featuring\s+', r'\s+feat\.?\s+', r'\s+f\.', r'\s+ft\.?\s+',
        r'\s+with\s+', r'\s+&\s+', r'\s+x\s+', r'\s+vs\.?\s+', r'\s+versus\s+'
    ]

    for pattern in patterns:
        artist = re.split(pattern, artist, flags=re.IGNORECASE)[0]

    # Remove content within parentheses and brackets
    artist = re.sub(r'\s*\([^)]*\)', '', artist)
    artist = re.sub(r'\s*\[[^\]]*\]', '', artist)

    # Remove "The " prefix for consistent matching
    artist = re.sub(r'^The\s+', '', artist, flags=re.IGNORECASE)

    # Trim and lowercase for consistent matching
    cleaned = artist.strip().lower()

    # Debug logging
    if original_artist != artist:
        logging.debug(f"Cleaned artist name from '{original_artist}' to '{cleaned}'")

    return cleaned

def fuzzy_match_names(query_name, target_name):
    """
    Perform fuzzy matching between query and target artist names.
    Uses case-insensitive partial matching and similarity scoring.
    """
    if not query_name or not target_name:
        return 0.0

    query_lower = query_name.lower().strip()
    target_lower = target_name.lower().strip()

    # Exact match gets highest score
    if query_lower == target_lower:
        return 1.0

    # Partial match (substring) gets high score
    if query_lower in target_lower or target_lower in query_lower:
        return 0.85

    # Word boundary matching for partial artist names
    query_words = set(query_lower.split())
    target_words = set(target_lower.split())

    # If all query words are in target words, it's a good match
    if query_words.issubset(target_words):
        return 0.75

    # Check individual words for partial matches
    for query_word in query_words:
        for target_word in target_words:
            if query_word in target_word or target_word in query_word:
                return min(0.6, 0.6 * (len(query_word) / len(target_word)) if len(target_word) > 0 else 0.4)

    return 0.0

async def fetch_artist_image_online(artist_name, client_session=None):
    """Fetch artist image from online APIs as fallback"""
    try:
        # Try MusicBrainz API first
        search_url = f"https://musicbrainz.org/ws/2/artist?query=artist:{artist_name}&fmt=json"

        if not client_session:
            async with aiohttp.ClientSession() as session:
                async with session.get(search_url, timeout=5) as response:
                    if response.status == 200:
                        data = await response.json()
                        if 'artists' in data and data['artists']:
                            artist_id = data['artists'][0]['id']
                            # Get detailed artist info
                            detail_url = f"https://musicbrainz.org/ws/2/artist/{artist_id}?inc=release-groups&fmt=json"
                            async with session.get(detail_url, timeout=5) as response:
                                if response.status == 200:
                                    detail_data = await response.json()
                                    # Try to find associated images (this is simplified)
                                    # In practice, would need more complex image fetching logic
                                    logging.debug(f"Found MusicBrainz entry for '{artist_name}'")
                                    return f"https://musicbrainz.org/images/artist/{artist_id}"

        return None
    except Exception as e:
        logging.debug(f"Online lookup failed for '{artist_name}': {e}")
        return None

def lookup_artist_images(artists):
    """
    Fast lookup artist images using preloaded cache with fuzzy matching.
    Returns dict mapping artist names to image URLs or initial fallbacks.
    """
    start_time = time.time()
    results = {}
    requests_processed = 0

    logging.debug(f"Processing {len(artists)} artist queries")
    logging.debug(f"Available lookup cache keys: {len(owner_lookup_cache)}")
    logging.debug(f"Available image cache entries: {len(artist_image_cache)}")

    for artist in artists:
        logging.debug(f"Processing artist: '{artist}'")
        if artist not in artist_image_cache:
            # Try direct cache hit first (original names)
            clean_name = clean_artist_name(artist)
            logging.debug(f"  Cleaned: '{clean_name}'")

            match_found = False

            # 1. Direct match from cached original names
            if clean_name in artist_image_cache:
                results[artist] = artist_image_cache[clean_name]
                artist_image_cache[artist] = artist_image_cache[clean_name]
                match_found = True
                logging.debug(f"  ✓ Direct cache match found")

            # 2. Exact match in lookup cache (cleaned names)
            if not match_found and clean_name in owner_lookup_cache:
                if owner_lookup_cache[clean_name]:
                    entry = owner_lookup_cache[clean_name][0]
                    results[artist] = entry['image']
                    artist_image_cache[artist] = entry['image']
                    logging.debug(f"  ✓ Lookup cache match found: '{entry['original_artist']}'")
                    match_found = True

            # 3. Fuzzy matching if no exact match
            if not match_found:
                best_match = None
                best_score = 0.0

                # Check all possible matches in our preloaded data
                for clean_key, entries in owner_lookup_cache.items():
                    score = fuzzy_match_names(clean_name, clean_key)
                    if score > 0.6 and score > best_score:  # Lower threshold for debugging
                        best_match = entries[0]
                        best_score = score
                        logging.debug(f"  Possible fuzzy match: '{clean_key}' (score: {best_score:.3f})")

                if best_match and best_score >= 0.6:
                    results[artist] = best_match['image']
                    artist_image_cache[artist] = best_match['image']
                    logging.debug(f"  ✓ Fuzzy match found: '{best_match['original_artist']}', score: {best_score:.3f}")
                    match_found = True
                elif best_score > 0:
                    logging.debug(f"  Low confidence match rejected (score: {best_score:.3f})")

            # 4. Additional fallback: try case-insensitive original name match
            if not match_found:
                # Try case-insensitive lookup in original artist names
                for original_cached_artist, image_url in artist_image_cache.items():
                    if original_cached_artist.lower() == artist.lower():
                        results[artist] = image_url
                        artist_image_cache[artist] = image_url
                        match_found = True
                        logging.debug(f"  ✓ Case-insensitive original match: '{original_cached_artist}'")
                        break

            # 5. Final fallback to initial
            if not match_found:
                results[artist] = artist[0].upper() if artist else '?'
                logging.debug(f"  ✗ No match found, using initial: '{results[artist]}'")
        else:
            # Direct cache hit
            results[artist] = artist_image_cache[artist]
            logging.debug(f"  ✓ Cached result found")

        requests_processed += 1

    elapsed = time.time() - start_time

    # Log performance and results
    found = sum(1 for result in results.values() if result.startswith('http'))
    logging.info(f"Artist lookup completed: {requests_processed} processed, {found} images found, took {elapsed:.3f}s")

    return results
# Connected clients
clients = {}
admin_clients = set()

# Global server reference for graceful shutdown
server_instance = None

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    if server_instance:
        # Close all client connections
        for websocket in list(clients.keys()):
            try:
                asyncio.create_task(websocket.close(1001, "Server shutting down"))
            except Exception as e:
                logger.debug(f"Error closing client connection: {e}")

        # Close admin connections
        admin_clients.clear()
        clients.clear()

        # Close server
        server_instance.close()

async def broadcast_shutdown_message():
    """Send shutdown message to all connected clients"""
    if clients:
        shutdown_msg = json.dumps({
            'action': 'server_shutdown',
            'message': 'Server is shutting down'
        })

        disconnected_clients = []
        for client in clients:
            try:
                await client.send(shutdown_msg)
            except Exception as e:
                logger.debug(f"Failed to send shutdown message: {e}")
                disconnected_clients.append(client)

        # Clean up disconnected clients
        for client in disconnected_clients:
            if client in clients:
                del clients[client]

        logger.info(f"Sent shutdown message to {len(clients)} clients")

async def handle_message(websocket, message):
    try:
        data = json.loads(message)
        action = data.get('action')
        logging.info(f"Received action: {action} from {clients.get(websocket, {}).get('user_name', 'unknown')}")
    except json.JSONDecodeError as e:
        logging.error(f"Invalid JSON received: {e}")
        return

    try:
        if action == 'join':
            user_id = data.get('user_id', str(uuid.uuid4()))
            is_admin = data.get('is_admin', False)
            user_name = data.get('user_name', '')
            user_avatar = data.get('user_avatar', '🐰')
            clients[websocket] = {'user_id': user_id, 'is_admin': is_admin, 'user_name': user_name, 'user_avatar': user_avatar}
            if is_admin:
                admin_clients.add(websocket)
            # Store user info
            conn = sqlite3.connect('rhythmcrew.db')
            c = conn.cursor()
            c.execute('INSERT OR REPLACE INTO users (id, name, avatar) VALUES (?, ?, ?)', (user_id, user_name, user_avatar))
            conn.commit()
            conn.close()
            # Send current state
            await send_state(websocket)

        elif action == 'request_song':
            song_id = data['song_id']
            user_id = clients[websocket]['user_id']
            # Add to queue
            conn = sqlite3.connect('rhythmcrew.db')
        elif action == 'lookup_artist_images':
            artists = data.get('artists', [])
            if artists:
                image_results = lookup_artist_images(artists)
                await websocket.send(json.dumps({
                    'action': 'artist_images',
                    'results': image_results
                }))

        elif action == 'request_song':
            song_id = data['song_id']
            user_id = clients[websocket]['user_id']
            # Add to queue
            conn = sqlite3.connect('rhythmcrew.db')
            c = conn.cursor()
            c.execute('INSERT INTO queue (song_id, user_id) VALUES (?, ?)', (song_id, user_id))
            conn.commit()
            conn.close()
            await broadcast_state()

        elif action == 'vote':
            queue_id = data['queue_id']
            vote_type = data['vote_type']  # 'up' or 'down'
            conn = sqlite3.connect('rhythmcrew.db')
            c = conn.cursor()
            if vote_type == 'up':
                c.execute('UPDATE queue SET upvotes = upvotes + 1 WHERE id = ?', (queue_id,))
            else:
                c.execute('UPDATE queue SET downvotes = downvotes + 1 WHERE id = ?', (queue_id,))
            conn.commit()
            conn.close()
            await broadcast_state()

        elif action == 'mark_played':
            if websocket in admin_clients:
                queue_id = data['queue_id']
                conn = sqlite3.connect('rhythmcrew.db')
                c = conn.cursor()
                c.execute('SELECT song_id FROM queue WHERE id = ?', (queue_id,))
                song_id = c.fetchone()[0]
                c.execute('INSERT INTO history (song_id) VALUES (?)', (song_id,))
                c.execute('DELETE FROM queue WHERE id = ?', (queue_id,))
                conn.commit()
                conn.close()
                await broadcast_state()

        elif action == 'remove_song':
            if websocket in admin_clients:
                queue_id = data['queue_id']
                conn = sqlite3.connect('rhythmcrew.db')
                c = conn.cursor()
                c.execute('DELETE FROM queue WHERE id = ?', (queue_id,))
                conn.commit()
                conn.close()
                await broadcast_state()

        elif action == 'remove_all':
            if websocket in admin_clients:
                conn = sqlite3.connect('rhythmcrew.db')
                c = conn.cursor()
                c.execute('DELETE FROM queue')
                conn.commit()
                conn.close()
                await broadcast_state()

        elif action == 'upload_songs':
            if websocket in admin_clients:
                songs = data['songs']
                conn = sqlite3.connect('rhythmcrew.db')
                c = conn.cursor()
                c.execute('DELETE FROM songs')  # Clear existing
                for song in songs:
                    c.execute('INSERT INTO songs (name, artist, album, genre, charter, year, songlength) VALUES (?, ?, ?, ?, ?, ?, ?)',
                             (song['Name'], song['Artist'], song['Album'], song['Genre'], song['Charter'], song['Year'], song['songlength']))
                conn.commit()
                conn.close()
                await broadcast_state()

        elif action == 'sort_queue':
            sort_type = data['sort_type']
            conn = sqlite3.connect('rhythmcrew.db')
            c = conn.cursor()
            if sort_type == 'oldest':
                c.execute('SELECT * FROM queue ORDER BY requested_at ASC')
            elif sort_type == 'newest':
                c.execute('SELECT * FROM queue ORDER BY requested_at DESC')
            elif sort_type == 'upvotes':
                # Sort by upvotes (descending), then by oldest for tie-breaking
                c.execute('SELECT * FROM queue ORDER BY upvotes DESC, requested_at ASC')
            elif sort_type == 'random':
                c.execute('SELECT * FROM queue ORDER BY RANDOM()')
            conn.close()
            await broadcast_state()
    except KeyError as e:
        logging.error(f"Missing key in message: {e}")
    except sqlite3.Error as e:
        logging.error(f"Database error: {e}")
    except Exception as e:
        logging.error(f"Unexpected error processing message: {e}")

async def send_state(websocket):
    conn = sqlite3.connect('rhythmcrew.db')
    c = conn.cursor()

    # Get songs
    c.execute('SELECT * FROM songs')
    songs = [{'id': row[0], 'name': row[1], 'artist': row[2], 'album': row[3], 'genre': row[4], 'charter': row[5], 'year': row[6], 'songlength': row[7]} for row in c.fetchall()]

    # Get queue - default to upvotes sorting (descending), then oldest for tie-breaking
    c.execute('''SELECT q.id, s.name, s.artist, q.upvotes, q.downvotes, q.requested_at, q.user_id, u.name, u.avatar
                 FROM queue q
                 JOIN songs s ON q.song_id = s.id
                 LEFT JOIN users u ON q.user_id = u.id
                 ORDER BY q.upvotes DESC, q.requested_at ASC''')
    queue = [{'id': row[0], 'name': row[1], 'artist': row[2], 'upvotes': row[3], 'downvotes': row[4], 'requested_at': row[5], 'user_id': row[6], 'user_name': row[7], 'user_avatar': row[8]} for row in c.fetchall()]

    # Get history
    c.execute('SELECT s.name, s.artist FROM history h JOIN songs s ON h.song_id = s.id ORDER BY h.played_at DESC LIMIT 15')
    history = [{'name': row[0], 'artist': row[1]} for row in c.fetchall()]

    conn.close()

    state = {
        'songs': songs,
        'queue': queue,
        'history': history
    }
    await websocket.send(json.dumps({'action': 'state', 'data': state}))

async def broadcast_state():
    logging.info(f"Broadcasting state to {len(clients)} clients")
    conn = sqlite3.connect('rhythmcrew.db')
    c = conn.cursor()

    c.execute('SELECT * FROM songs')
    songs = [{'id': row[0], 'name': row[1], 'artist': row[2], 'album': row[3], 'genre': row[4], 'charter': row[5], 'year': row[6], 'songlength': row[7]} for row in c.fetchall()]

    c.execute('''SELECT q.id, s.name, s.artist, q.upvotes, q.downvotes, q.requested_at, q.user_id, u.name, u.avatar
                 FROM queue q
                 JOIN songs s ON q.song_id = s.id
                 LEFT JOIN users u ON q.user_id = u.id
                 ORDER BY q.upvotes DESC, q.requested_at ASC''')
    queue = [{'id': row[0], 'name': row[1], 'artist': row[2], 'upvotes': row[3], 'downvotes': row[4], 'requested_at': row[5], 'user_id': row[6], 'user_name': row[7], 'user_avatar': row[8]} for row in c.fetchall()]

    c.execute('SELECT s.name, s.artist FROM history h JOIN songs s ON h.song_id = s.id ORDER BY h.played_at DESC LIMIT 15')
    history = [{'name': row[0], 'artist': row[1]} for row in c.fetchall()]

    conn.close()

    state = {
        'songs': songs,
        'queue': queue,
        'history': history
    }
    message = json.dumps({'action': 'state', 'data': state})
    disconnected_clients = []
    for client in clients:
        try:
            await client.send(message)
        except Exception as e:
            logging.error(f"Failed to send to client: {e}")
            disconnected_clients.append(client)
    # Remove disconnected clients
    for client in disconnected_clients:
        if client in clients:
            user_info = clients[client]
            logging.info(f"Removing disconnected client: {user_info.get('user_name', 'unknown')}")
            if user_info['is_admin']:
                admin_clients.discard(client)
            del clients[client]

async def handler(websocket, path=None):
    # Debug: Log what arguments we're receiving
    import inspect
    frame = inspect.currentframe()
    args = frame.f_locals
    logger.debug(f"Handler called with args: websocket={type(websocket).__name__}, path={path}")

    client_info = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}" if hasattr(websocket, 'remote_address') else "unknown"
    logger.info(f"New WebSocket connection from {client_info} on path {path}")

    try:
        # Send ping every 30 seconds to keep connection alive
        async def ping_loop():
            try:
                while True:
                    await asyncio.sleep(30)
                    await websocket.ping()
                    logger.debug(f"Ping sent to {client_info}")
            except asyncio.CancelledError:
                logger.debug(f"Ping loop cancelled for {client_info}")
            except Exception as e:
                logger.warning(f"Ping failed for {client_info}: {e}")
                raise  # Re-raise to stop the connection

        ping_task = asyncio.create_task(ping_loop())
        logger.debug(f"Started ping task for {client_info}")

        async for message in websocket:
            try:
                logger.debug(f"Received message from {client_info}: {message[:100]}...")
                await handle_message(websocket, message)
            except json.JSONDecodeError as e:
                logger.warning(f"Invalid JSON received from {client_info}: {e}")
                try:
                    await websocket.send(json.dumps({
                        'action': 'error',
                        'message': 'Invalid JSON format'
                    }))
                except Exception:
                    pass  # Client might be disconnecting
            except KeyError as e:
                logger.warning(f"Missing required field in message from {client_info}: {e}")
                try:
                    await websocket.send(json.dumps({
                        'action': 'error',
                        'message': f'Missing required field: {e}'
                    }))
                except Exception:
                    pass
            except Exception as e:
                logger.error(f"Error processing message from {client_info}: {e}", exc_info=True)
                try:
                    await websocket.send(json.dumps({
                        'action': 'error',
                        'message': 'Internal server error'
                    }))
                except Exception:
                    pass

        # Cancel ping task when connection ends normally
        ping_task.cancel()
        try:
            await ping_task
        except asyncio.CancelledError:
            pass

    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"WebSocket connection closed from {client_info} (code: {e.code}, reason: {e.reason})")
    except asyncio.CancelledError:
        logger.info(f"WebSocket handler cancelled for {client_info}")
    except Exception as e:
        logger.error(f"WebSocket handler error from {client_info}: {e}", exc_info=True)
    finally:
        # Cancel ping task if still running
        if 'ping_task' in locals() and not ping_task.done():
            ping_task.cancel()
            try:
                await ping_task
            except asyncio.CancelledError:
                pass

        # Clean up client
        if websocket in clients:
            user_info = clients[websocket]
            logger.info(f"Removing client {client_info} (user: {user_info.get('user_name', 'unknown')})")
            if clients[websocket]['is_admin']:
                admin_clients.discard(websocket)
            del clients[websocket]

        logger.info(f"Connection handler finished for {client_info}")

def start_http_server():
    """Start a simple HTTP server for testing"""
    try:
        server_address = ('', 8000)
        httpd = HTTPServer(server_address, SimpleHTTPRequestHandler)
        print("HTTP server started on http://localhost:8000")
        print("Open http://localhost:8000/index.html in your browser")
        httpd.serve_forever()
    except Exception as e:
        print(f"HTTP server error: {e}")

async def log_server_stats():
    """Log server statistics every 60 seconds"""
    while True:
        try:
            await asyncio.sleep(60)
            logger.info(f"Server stats - Connected clients: {len(clients)}, Admin clients: {len(admin_clients)}")

            # Log client details
            if clients:
                client_list = [f"{info.get('user_name', 'unknown')}({info.get('user_id', 'unknown')[:8]})"
                             for info in clients.values()]
                logger.debug(f"Connected users: {', '.join(client_list)}")

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in stats logging: {e}")

async def main():
    global server_instance

    logger.info("Starting Farias' Song Interface server...")

    # Set up signal handlers for graceful shutdown
    if os.name != 'nt':  # Unix-like systems
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)
    else:  # Windows
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)

    if not WEBSOCKETS_AVAILABLE:
        logger.error("WebSocket server cannot start - websockets library not available")
        logger.info("Starting fallback HTTP server instead...")
        start_http_server()
        return

    # Start statistics logging
    stats_task = asyncio.create_task(log_server_stats())

    try:
        # Load artist database before starting server
        logger.info("Loading artist database...")
        # Temporarily increase logging level to see CSV loading output
        old_level = logging.getLogger().level
        logging.getLogger().setLevel(logging.DEBUG)
        load_artist_database()
        logging.getLogger().setLevel(old_level)
        logger.info("Database loading completed")

        logger.info("Initializing WebSocket server...")
        server_instance = await websockets.serve(
            handler,
            "localhost",
            8766,
            ping_interval=30,  # Send pings every 30 seconds
            ping_timeout=10,   # Wait 10 seconds for pong response
            close_timeout=5    # Wait 5 seconds for close handshake
        )

        logger.info("WebSocket server started successfully")
        logger.info("Server details:")
        logger.info("  - WebSocket URL: ws://localhost:8766")
        logger.info("  - HTTP fallback: http://localhost:8000")
        logger.info("  - Open index.html in your browser to use the application")
        logger.info("  - Press Ctrl+C to stop the server gracefully")

        # Optional: Run artist lookup test
        # test_artist_lookup()

        # Wait for server to close
        await server_instance.wait_closed()

    except KeyboardInterrupt:
        logger.info("Server shutdown requested by user")
        await broadcast_shutdown_message()
    except Exception as e:
        logger.error(f"Server startup error: {e}", exc_info=True)
        logger.info("Starting fallback HTTP server instead...")
        start_http_server()
    finally:
        # Clean up stats task
        stats_task.cancel()
        try:
            await stats_task
        except asyncio.CancelledError:
            pass

        logger.info("Server shutdown complete")

if __name__ == "__main__":
    asyncio.run(main())