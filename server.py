import asyncio
import json
import websockets
import http.server
import socketserver
import threading
from datetime import datetime
import os

DB_FILE = "db.json"

def load_state():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'r') as f:
            try:
                state = json.load(f)
                if isinstance(state, dict) and isinstance(state.get("requests"), list):
                    return state
                print("Warning: db.json is malformed. Starting with an empty queue.")
                return {"requests": []}
            except (json.JSONDecodeError, TypeError):
                print("Warning: Could not decode db.json. Starting with an empty queue.")
                return {"requests": []}
    return {"requests": []}

def save_state():
    with open(DB_FILE, 'w') as f:
        json.dump(STATE, f, indent=2)
    print(f"[SERVER] State saved. Queue now has {len(STATE['requests'])} songs.")

STATE = load_state()
CLIENTS = set()

async def broadcast(message):
    if CLIENTS:
        tasks = [asyncio.create_task(client.send(message)) for client in CLIENTS]
        if tasks:
            await asyncio.wait(tasks)

async def notify_state_change():
    print("[SERVER] Notifying clients of state change.")
    await broadcast(json.dumps({"type": "state", "data": STATE}))

async def handler(websocket):
    global STATE
    try:
        CLIENTS.add(websocket)
        print(f"[SERVER] Client connected. Total clients: {len(CLIENTS)}")
        await websocket.send(json.dumps({"type": "state", "data": STATE}))
        
        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get("action")
                print(f"\n[SERVER] Received action '{action}' with data: {data}")
                state_changed = False

                if action == "add":
                    song = data.get("song")
                    if song and isinstance(song, dict):
                        song_name = song.get("Name")
                        is_in_queue = any(s.get("Name") == song_name for s in STATE.get("requests", []))
                        print(f"[SERVER] Checking if '{song_name}' is in queue... Result: {is_in_queue}")
                        if not is_in_queue:
                            song["timestamp"] = datetime.now().isoformat()
                            STATE["requests"].append(song)
                            state_changed = True
                            print(f"[SERVER] Added '{song_name}'. State changed.")
                        else:
                             print(f"[SERVER] Song '{song_name}' already in queue. No change.")
                    else:
                        print("[SERVER] Error: 'add' action received without a valid song object.")

                elif action in ["remove", "forceRemove"]:
                    song_name = data.get("songName")
                    initial_len = len(STATE["requests"])
                    song_to_remove = next((s for s in STATE["requests"] if s.get("Name") == song_name), None)
                    
                    if song_to_remove:
                        can_remove = (
                            action == "forceRemove" or
                            song_to_remove.get("isRandom") or
                            song_to_remove.get("userAvatar") == data.get("userAvatar")
                        )
                        print(f"[SERVER] Attempting to remove '{song_name}'. Can remove? {can_remove}")
                        if can_remove:
                            STATE["requests"] = [s for s in STATE["requests"] if s.get("Name") != song_name]
                            if len(STATE["requests"]) < initial_len:
                                state_changed = True
                                print(f"[SERVER] Removed '{song_name}'. State changed.")
                    else:
                        print(f"[SERVER] Song '{song_name}' not found for removal.")

                # ... other actions like reorder, clearAll, etc. ...
                elif action == "reorder":
                    STATE["requests"] = [next(s for s in STATE["requests"] if s["Name"] == name) for name in data["songs"] if any(s["Name"] == name for s in STATE["requests"])]
                    state_changed = True
                
                elif action == "addMultiple":
                    for song in data["songs"]:
                        if not any(s["Name"] == song["Name"] for s in STATE["requests"]):
                            song["timestamp"] = datetime.now().isoformat()
                            STATE["requests"].append(song)
                            state_changed = True

                elif action == "clearAll":
                    if STATE["requests"]:
                        STATE["requests"] = []
                        state_changed = True

                elif action == "clearByUser":
                    avatar_to_clear = data.get("userAvatar")
                    initial_length = len(STATE["requests"])
                    STATE["requests"] = [s for s in STATE["requests"] if s.get("userAvatar") != avatar_to_clear]
                    if len(STATE["requests"]) < initial_length:
                        state_changed = True

                elif action == "nowPlaying":
                    song_name = data.get("songName")
                    notification = {"type": "toast", "message": f"Now Playing: {song_name}"}
                    await broadcast(json.dumps(notification))


                if state_changed:
                    save_state()
                    await notify_state_change()
                else:
                    print("[SERVER] No state change detected. No notification sent.")

            except Exception as e:
                print(f"[SERVER] Error processing message: {e}")
    
    except websockets.exceptions.ConnectionClosedError:
        pass # Client disconnected, normal behavior
    finally:
        CLIENTS.remove(websocket)
        print(f"[SERVER] Client disconnected. Total clients: {len(CLIENTS)}")

def run_http_server():
    PORT = 8000
    Handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"[HTTP] Server serving at http://localhost:{PORT}")
        httpd.serve_forever()

async def main():
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    async with websockets.serve(handler, "", 5678):
        print("[WS] WebSocket server started on port 5678")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())