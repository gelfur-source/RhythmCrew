// js/websocket.js

let ws;
let onStateChangeCallback;
let onToastCallback;
let isReconnecting = false;

function connect() {
    ws = new WebSocket(`ws://${window.location.hostname}:5678`);

    ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'state' && onStateChangeCallback) {
            onStateChangeCallback(payload.data.requests);
        } else if (payload.type === 'toast' && onToastCallback) {
            onToastCallback(payload.message);
        }
    };

    ws.onopen = () => {
        console.log("Connected to real-time server.");
        isReconnecting = false;
    };

    ws.onclose = () => {
        console.log("Disconnected. Attempting to reconnect...");
        if (!isReconnecting) {
            isReconnecting = true;
            setTimeout(() => location.reload(), 2000);
        }
    };

    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.close();
    };
}

export const websocket = {
    init: (onStateChange, onToast) => {
        onStateChangeCallback = onStateChange;
        onToastCallback = onToast;
        connect();
    },
    send: (data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        } else {
            console.error("WebSocket is not connected.");
        }
    }
};