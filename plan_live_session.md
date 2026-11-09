# Plan: Sua Lich Su Phien Live

## Bug Hien Tai

### 1. Session duoc tao sai thoi diem
- Hien tai: User phai bam nut "Luu phien" thu cong sau khi live xong
- Frontend: `window.saveCurrentSession()` → POST `/api/live-sessions`
- **Van de**: Neu user quen bam → mat lich su. Neu bam nhieu lan → trung lap.

### 2. Khi bat dau live moi, server tu dong load file cu (khong hoi)
```js
// server.js dong 2221-2225
const fileName = getSessionFileName(userId, broadcasterId);
if (fs.existsSync(fileName)) {
    runtime.confirmedOrders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(fileName)));
} else {
    runtime.confirmedOrders = {};
}
```
File nay la `YYYY-MM-DD_broadcaster.json` → neu live 2 lan trong ngay → tu load lai orders cu, **khong hoi user**.

### 3. Ten phien thieu gio phut giay
- Hien tai: `2026-11-01_anhthukyguitanphu`
- Can: `2026-11-01 14:32:05_anhthukyguitanphu`

### 4. Khong co su kien ket thuc live
- Khong co event `end-live`
- Khong tu dong luu lich su khi ket thuc

---

## Muc Tieu Moi

1. **Khi bam "Ket noi Live"** → Server TAO session moi (voi `startedAt = NOW`)
2. **Trong khi live** → Tu dong luu don vao session dang mo
3. **Khi bam "Ket thuc Live"** → Server ghi `endedAt = NOW`, luu chinh thuc vao lich su
4. **Lan live tiep theo** → Hoi: "Dung lai lich su cu?" hay "Tao moi?"
5. **Hien thi gio phut giay** trong ten va metadata phien

---

## Plan Chi Tiet

### BUOC 1 — server.js: Sua `createEmptyLiveRuntime`

Them 2 field moi:

```js
function createEmptyLiveRuntime(userId) {
    return {
        userId,
        tiktokConnection: null,
        confirmedOrders: {},
        currentBroadcasterId: '',
        currentSessionId: null,          // NEW: ID phien dang live
        currentSessionStartedAt: null,   // NEW: Thoi diem bat dau ISO string
        processedMsgIds: new Set(),
        chatBufferByBroadcaster: new Map(),
        sockets: new Set()
    };
}
```

---

### BUOC 2 — server.js: Sua `getSessionFileName` dung sessionId

**Truoc (loi):**
```js
function getSessionFileName(userId, broadcasterId) {
    const date = new Date().toISOString().split('T')[0]; // theo ngay → ghi de
    return path.join(getUserHistoryDir(userId), `${date}_${safeBroadcasterId}.json`);
}
```

**Sau (sua):**
```js
function getSessionFileName(userId, broadcasterId, sessionId) {
    const safeBroadcasterId = customerStore.normalizeTikTokUsername(broadcasterId) || 'unknown';
    const id = sessionId || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    return path.join(getUserHistoryDir(userId), `${id}_${safeBroadcasterId}.json`);
}
// Va cap nhat saveSessionDataForUser de truyen runtime.currentSessionId
function saveSessionDataForUser(userId) {
    const runtime = getLiveRuntime(userId);
    if (!runtime.currentBroadcasterId) return;
    const fileName = getSessionFileName(userId, runtime.currentBroadcasterId, runtime.currentSessionId);
    // ... giu nguyen phan con lai
}
```

---

### BUOC 3 — server.js: Sua event `start-live`

**Them ham ho tro:**
```js
function formatLiveName(broadcasterId, startedAt) {
    const d = startedAt ? new Date(startedAt) : new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = [d.getFullYear(), pad(d.getMonth()+1), pad(d.getDate())].join('-');
    const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':');
    return `${date} ${time}_${broadcasterId}`;
}

function generateRuntimeSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}
```

**Sua event `start-live`:**
```js
socket.on('start-live', (payload) => {
    // payload co the la string (cu) hoac object {uniqueId, resumeSessionId}
    const rawId = typeof payload === 'string' ? payload : payload?.uniqueId;
    const resumeSessionId = typeof payload === 'object' ? payload?.resumeSessionId : undefined;
    
    const broadcasterId = customerStore.normalizeTikTokUsername(rawId);
    if (!broadcasterId) {
        return socket.emit('status', { connected: false, error: 'TikTok ID khong hop le', broadcasterId: '' });
    }

    if (runtime.tiktokConnection) {
        try { runtime.tiktokConnection.disconnect(); } catch (e) {}
        runtime.tiktokConnection = null;
    }

    const now = new Date();

    // Kiem tra neu chua truyen resumeSessionId (user chua chon)
    if (resumeSessionId === undefined) {
        // Tim session cu chua ket thuc cua broadcaster nay
        const sessions = liveSessionStore.readUserSessions(userId);
        const lastSession = sessions.find(s => 
            s.tiktokUsername === broadcasterId && s.endedAt === null
        );
        // Hoac tim session trong ngay hom nay (file tam)
        const tempFileName = getLastTempFileName(userId, broadcasterId);
        
        if (lastSession || tempFileName) {
            const sessionInfo = lastSession || { 
                id: null, 
                liveName: formatLiveName(broadcasterId, null),
                startedAt: null,
                summary: { totalOrders: 0, totalRevenue: 0 }
            };
            // Gui tin hieu ve client de hoi
            return socket.emit('ask-resume-session', { session: sessionInfo, broadcasterId });
        }
    }

    // Thiet lap session
    if (resumeSessionId) {
        const oldSession = liveSessionStore.getLiveSessionById(userId, resumeSessionId);
        if (oldSession) {
            runtime.confirmedOrders = rebuildConfirmedOrders(oldSession.orders || []);
            runtime.currentSessionId = resumeSessionId;
            runtime.currentSessionStartedAt = oldSession.startedAt;
        } else {
            runtime.confirmedOrders = {};
            runtime.currentSessionId = generateRuntimeSessionId();
            runtime.currentSessionStartedAt = now.toISOString();
        }
    } else {
        runtime.confirmedOrders = {};
        runtime.currentSessionId = generateRuntimeSessionId();
        runtime.currentSessionStartedAt = now.toISOString();
    }

    runtime.currentBroadcasterId = broadcasterId;
    runtime.processedMsgIds.clear();
    emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);

    // Ket noi TikTok nhu cu...
    const userConnection = new WebcastPushConnection(broadcasterId);
    runtime.tiktokConnection = userConnection;
    // ... (giu nguyen phan connection, chat listener, etc.)
});
```

---

### BUOC 4 — server.js: Them event `end-live`

Them vao trong `io.on('connection', ...)`:
```js
socket.on('end-live', () => {
    const now = new Date();
    const hasOrders = Object.keys(runtime.confirmedOrders).length > 0 &&
        Object.values(runtime.confirmedOrders).some(c => (c.items || []).length > 0);

    if (!hasOrders || !runtime.currentBroadcasterId) {
        // Khong co don → khong luu, chi reset
        runtime.confirmedOrders = {};
        runtime.currentSessionId = null;
        runtime.currentSessionStartedAt = null;
        if (runtime.tiktokConnection) {
            try { runtime.tiktokConnection.disconnect(); } catch (e) {}
            runtime.tiktokConnection = null;
        }
        runtime.currentBroadcasterId = '';
        return socket.emit('session-ended', { saved: false });
    }

    try {
        const liveName = formatLiveName(runtime.currentBroadcasterId, runtime.currentSessionStartedAt);
        const session = liveSessionStore.createLiveSession(userId, {
            id: runtime.currentSessionId,
            liveName,
            tiktokUsername: runtime.currentBroadcasterId,
            startedAt: runtime.currentSessionStartedAt || now.toISOString(),
            endedAt: now.toISOString(),
            orders: runtime.confirmedOrders
        });

        // Xoa file tam neu ton tai
        const tempFile = getSessionFileName(userId, runtime.currentBroadcasterId, runtime.currentSessionId);
        if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch(e) {}
        }

        // Reset runtime
        runtime.confirmedOrders = {};
        runtime.currentSessionId = null;
        runtime.currentSessionStartedAt = null;
        if (runtime.tiktokConnection) {
            try { runtime.tiktokConnection.disconnect(); } catch (e) {}
            runtime.tiktokConnection = null;
        }
        runtime.currentBroadcasterId = '';

        emitToUser(userId, 'all-confirmed-orders', {});
        socket.emit('session-ended', { saved: true, session });
    } catch (error) {
        console.error('Loi luu phien live:', error);
        socket.emit('session-ended', { saved: false, error: error.message });
    }
});
```

---

### BUOC 5 — liveSessionStore.js: Ho tro external `id`

Sua `createLiveSession` de khong ghi de ID neu da co:
```js
function createLiveSession(userId, data) {
    const sessions = readUserSessions(userId);
    // ...
    const newSession = {
        id: data.id || generateSessionId(), // Su dung ID tu ngoai neu co
        // ... con lai giu nguyen
    };
    // ...
}
```

---

### BUOC 6 — dashboard.js: Sua Frontend

**6.1 — Sua emit `start-live`:**
```js
// Tim nut "Ket noi" / "Bat dau Live"
connectBtn.addEventListener('click', () => {
    const tiktokId = tiktokInput.value.trim();
    if (!tiktokId) return;
    // Emit object thay vi string de tuong thich backward compatible
    socket.emit('start-live', { uniqueId: tiktokId });
});
```

**6.2 — Them handler `ask-resume-session`:**
```js
socket.on('ask-resume-session', ({ session, broadcasterId }) => {
    const startTime = session.startedAt 
        ? new Date(session.startedAt).toLocaleString('vi-VN') 
        : 'Khong ro';
    const orders = session.summary?.totalOrders || 0;
    const revenue = (session.summary?.totalRevenue || 0).toLocaleString('vi-VN') + 'd';
    
    showConfirmDialog({
        title: 'Phien Live Chua Ket Thuc',
        message: `Ban co phien live gan day:\n📅 Bat dau: ${startTime}\n📦 ${orders} don — ${revenue}\n\nBan muon tiep tuc phien cu hay tao phien moi?`,
        confirmText: 'Tiep tuc phien cu',
        cancelText: 'Tao phien moi',
        onConfirm: () => {
            socket.emit('start-live', { uniqueId: broadcasterId, resumeSessionId: session.id });
        },
        onCancel: () => {
            socket.emit('start-live', { uniqueId: broadcasterId, resumeSessionId: null });
        }
    });
});
```

**6.3 — Them nut "Ket thuc Live" va handler:**
```js
// Them nut trong HTML hoac tao dong
endLiveBtn.addEventListener('click', () => {
    if (confirm('Ban co muon ket thuc phien live va luu lich su khong?')) {
        socket.emit('end-live');
    }
});

socket.on('session-ended', ({ saved, session, error }) => {
    if (saved && session) {
        showToast(`✅ Da luu phien live "${session.liveName}" (${session.summary.totalOrders} don)`);
    } else if (error) {
        showToast(`❌ Loi luu phien: ${error}`, 'error');
    }
    // Cap nhat UI: trang thai ngat ket noi
    updateConnectionStatus(false);
});
```

**6.4 — Sua hien thi thoi gian trong lich su:**
```js
// Trong ham render list phien live
function formatSessionDate(startedAt) {
    if (!startedAt) return 'Khong ro ngay';
    return new Date(startedAt).toLocaleString('vi-VN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'  // Them giay
    });
    // → "01/11/2026, 14:32:05"
}
```

---

## File Can Sua

| File | Noi dung thay doi |
|------|-------------------|
| `server.js` | createEmptyLiveRuntime, getSessionFileName, saveSessionDataForUser, event start-live, them event end-live, them ham formatLiveName + generateRuntimeSessionId |
| `utils/liveSessionStore.js` | createLiveSession ho tro external id |
| `public/js/dashboard.js` | emit start-live moi, handler ask-resume-session, them end-live button + handler, format hien thi thoi gian |
| `public/app.html` | Them nut "Ket thuc Live" vao UI |

---

## Luong Moi Hoan Chinh

```
User bam "Ket noi Live"
  → socket.emit('start-live', {uniqueId})
  → Server kiem tra session cu
    → Co → emit('ask-resume-session') → User chon
    → Khong → Tao session moi (currentSessionId, currentSessionStartedAt = NOW)
  → TikTok connect
  → Nhan binh luan, xac nhan don → saveSessionDataForUser (file tam)

User bam "Ket thuc Live"
  → socket.emit('end-live')
  → Server: liveSessionStore.createLiveSession({endedAt: NOW, ...})
  → Xoa file tam
  → emit('session-ended', {saved: true, session})
  → Hien thi toast thong bao

Lan live tiep theo
  → Neu co session chua ket thuc → hoi
  → User chon tiep tuc → load orders cu
  → User chon moi → confirmedOrders = {}
```

