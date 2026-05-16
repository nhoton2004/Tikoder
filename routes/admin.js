/**
 * Admin API routes — Quản lý tài khoản và phân quyền
 * Tất cả routes đều yêu cầu role admin hoặc super_admin
 */
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const liveSessionStore = require('../utils/liveSessionStore');

// --- Helpers ---
const ROLE_HIERARCHY = { 'super_admin': 4, 'admin': 3, 'staff': 2, 'user': 1 };

function getRoleLevel(role) {
    return ROLE_HIERARCHY[role] || 0;
}

function isAdminRole(role) {
    return role === 'admin' || role === 'super_admin';
}

// --- Middleware ---
function requireAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user || !user.uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (!isAdminRole(user.role)) return res.status(403).json({ error: 'Không có quyền truy cập' });
    next();
}

function requireSuperAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user || !user.uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (user.role !== 'super_admin') return res.status(403).json({ error: 'Chỉ Super Admin mới có quyền' });
    next();
}

// Helper: đếm super_admin
async function countSuperAdmins() {
    let count = 0;
    let nextPageToken;
    do {
        const listResult = await admin.auth().listUsers(1000, nextPageToken);
        listResult.users.forEach(u => {
            if (u.customClaims?.role === 'super_admin') count++;
        });
        nextPageToken = listResult.pageToken;
    } while (nextPageToken);
    return count;
}

// Helper: lấy role của target user
async function getTargetUserRole(uid) {
    const user = await admin.auth().getUser(uid);
    return user.customClaims?.role || 'user';
}

// ============================================================
// GET /api/admin/users — Danh sách tất cả user
// ============================================================
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = [];
        let nextPageToken;
        do {
            const listResult = await admin.auth().listUsers(1000, nextPageToken);
            listResult.users.forEach(u => {
                users.push({
                    uid: u.uid,
                    email: u.email || '',
                    displayName: u.displayName || '',
                    photoURL: u.photoURL || '',
                    disabled: u.disabled,
                    emailVerified: u.emailVerified,
                    creationTime: u.metadata.creationTime,
                    lastSignInTime: u.metadata.lastSignInTime,
                    providerData: u.providerData.map(p => ({ providerId: p.providerId })),
                    role: u.customClaims?.role || 'user',
                    permissions: u.customClaims?.permissions || []
                });
            });
            nextPageToken = listResult.pageToken;
        } while (nextPageToken);

        res.json({ users });
    } catch (error) {
        console.error('Lỗi lấy danh sách users:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ============================================================
// POST /api/admin/users — Tạo tài khoản mới
// ============================================================
router.post('/users', requireAdmin, async (req, res) => {
    try {
        const caller = req.session.user;
        const { email, password, displayName, role, permissions } = req.body;

        if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });

        const targetRole = role || 'user';
        // Admin thường chỉ tạo staff/user
        if (caller.role !== 'super_admin' && getRoleLevel(targetRole) >= getRoleLevel('admin')) {
            return res.status(403).json({ error: 'Chỉ Super Admin mới được tạo tài khoản Admin' });
        }

        const newUser = await admin.auth().createUser({
            email,
            password,
            displayName: displayName || '',
            emailVerified: false
        });

        await admin.auth().setCustomUserClaims(newUser.uid, {
            role: targetRole,
            permissions: permissions || []
        });

        console.log(`>>> Admin ${caller.email} đã tạo user ${email} (role: ${targetRole})`);
        res.json({ success: true, uid: newUser.uid });
    } catch (error) {
        console.error('Lỗi tạo user:', error);
        if (error.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'Email đã tồn tại' });
        }
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// PATCH /api/admin/users/:uid — Sửa tài khoản
// ============================================================
router.patch('/users/:uid', requireAdmin, async (req, res) => {
    try {
        const caller = req.session.user;
        const { uid } = req.params;
        const { email, password, displayName, disabled, role, permissions } = req.body;

        const targetRole = await getTargetUserRole(uid);

        // Admin thường không sửa admin/super_admin
        if (caller.role !== 'super_admin' && getRoleLevel(targetRole) >= getRoleLevel('admin')) {
            return res.status(403).json({ error: 'Không có quyền sửa tài khoản này' });
        }

        // Cập nhật thông tin cơ bản
        const updateData = {};
        if (email) updateData.email = email;
        if (password) updateData.password = password;
        if (displayName !== undefined) updateData.displayName = displayName;
        if (disabled !== undefined) updateData.disabled = disabled;

        if (Object.keys(updateData).length > 0) {
            await admin.auth().updateUser(uid, updateData);
        }

        // Cập nhật role/claims nếu có
        if (role !== undefined) {
            const newRole = role || 'user';
            // Admin thường không nâng lên admin/super_admin
            if (caller.role !== 'super_admin' && getRoleLevel(newRole) >= getRoleLevel('admin')) {
                return res.status(403).json({ error: 'Không có quyền cấp role này' });
            }
            // Không cho hạ super_admin cuối cùng
            if (targetRole === 'super_admin' && newRole !== 'super_admin') {
                const count = await countSuperAdmins();
                if (count <= 1) return res.status(400).json({ error: 'Không thể hạ quyền Super Admin cuối cùng' });
            }
            await admin.auth().setCustomUserClaims(uid, { role: newRole, permissions: permissions || [] });
        }

        console.log(`>>> Admin ${caller.email} đã sửa user ${uid}`);
        res.json({ success: true, message: 'Đã cập nhật. Người dùng cần đăng nhập lại để quyền mới có hiệu lực.' });
    } catch (error) {
        console.error('Lỗi sửa user:', error);
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// DELETE /api/admin/users/:uid — Xóa tài khoản
// ============================================================
router.delete('/users/:uid', requireAdmin, async (req, res) => {
    try {
        const caller = req.session.user;
        const { uid } = req.params;

        if (uid === caller.uid) return res.status(400).json({ error: 'Không thể tự xóa tài khoản của mình' });

        const targetRole = await getTargetUserRole(uid);

        if (caller.role !== 'super_admin' && getRoleLevel(targetRole) >= getRoleLevel('admin')) {
            return res.status(403).json({ error: 'Không có quyền xóa tài khoản này' });
        }
        if (targetRole === 'super_admin') {
            const count = await countSuperAdmins();
            if (count <= 1) return res.status(400).json({ error: 'Không thể xóa Super Admin cuối cùng' });
        }

        await admin.auth().deleteUser(uid);
        // Không xóa dữ liệu live-sessions, giữ lại archive
        console.log(`>>> Admin ${caller.email} đã xóa user ${uid} (dữ liệu live-sessions được giữ lại)`);
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa user:', error);
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// POST /api/admin/users/:uid/disable — Khóa tài khoản
// ============================================================
router.post('/users/:uid/disable', requireAdmin, async (req, res) => {
    try {
        const caller = req.session.user;
        const { uid } = req.params;
        const targetRole = await getTargetUserRole(uid);

        if (caller.role !== 'super_admin' && getRoleLevel(targetRole) >= getRoleLevel('admin')) {
            return res.status(403).json({ error: 'Không có quyền khóa tài khoản này' });
        }
        if (targetRole === 'super_admin') {
            const count = await countSuperAdmins();
            if (count <= 1) return res.status(400).json({ error: 'Không thể khóa Super Admin cuối cùng' });
        }

        await admin.auth().updateUser(uid, { disabled: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// POST /api/admin/users/:uid/enable — Mở khóa tài khoản
// ============================================================
router.post('/users/:uid/enable', requireAdmin, async (req, res) => {
    try {
        await admin.auth().updateUser(req.params.uid, { disabled: false });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// PATCH /api/admin/users/:uid/role — Đổi role
// ============================================================
router.patch('/users/:uid/role', requireAdmin, async (req, res) => {
    try {
        const caller = req.session.user;
        const { uid } = req.params;
        const { role, permissions } = req.body;

        if (!role) return res.status(400).json({ error: 'Thiếu role' });

        const targetRole = await getTargetUserRole(uid);

        if (caller.role !== 'super_admin') {
            if (getRoleLevel(targetRole) >= getRoleLevel('admin')) {
                return res.status(403).json({ error: 'Không có quyền đổi role tài khoản này' });
            }
            if (getRoleLevel(role) >= getRoleLevel('admin')) {
                return res.status(403).json({ error: 'Không có quyền cấp role này' });
            }
        }

        if (targetRole === 'super_admin' && role !== 'super_admin') {
            const count = await countSuperAdmins();
            if (count <= 1) return res.status(400).json({ error: 'Không thể hạ quyền Super Admin cuối cùng' });
        }

        await admin.auth().setCustomUserClaims(uid, { role, permissions: permissions || [] });
        console.log(`>>> Admin ${caller.email} đã đổi role ${uid} -> ${role}`);
        res.json({ success: true, message: 'Đã cập nhật quyền. Người dùng cần đăng xuất/đăng nhập lại để quyền mới có hiệu lực.' });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Lỗi server' });
    }
});

// ============================================================
// GET /api/admin/users/:uid/live-sessions — Xem lịch sử live của user
// ============================================================
router.get('/users/:uid/live-sessions', requireAdmin, async (req, res) => {
    try {
        const sessions = liveSessionStore.readUserSessions(req.params.uid);
        const list = sessions.map(s => ({
            id: s.id,
            liveName: s.liveName,
            tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            createdAt: s.createdAt,
            summary: s.summary
        }));
        res.json({ sessions: list });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

module.exports = router;
