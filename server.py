import asyncio
import json
import sqlite3
import uuid
import os
import logging
import signal
import sys
from datetime import datetime

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