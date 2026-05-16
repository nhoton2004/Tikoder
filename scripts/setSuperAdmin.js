/**
 * Script cấp quyền super_admin cho tài khoản đầu tiên
 * Chạy: node scripts/setSuperAdmin.js your_email@gmail.com
 */
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = require('../firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error('❌ Vui lòng nhập email: node scripts/setSuperAdmin.js your@email.com');
        process.exit(1);
    }

    try {
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(user.uid, {
            role: 'super_admin',
            permissions: ['*']
        });
        console.log(`\n✅ Đã cấp quyền SUPER_ADMIN cho: ${email}`);
        console.log(`   UID: ${user.uid}`);
        console.log(`\n⚠️  Người dùng cần ĐĂNG XUẤT và ĐĂNG NHẬP LẠI để quyền mới có hiệu lực.\n`);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.error(`❌ Không tìm thấy tài khoản: ${email}`);
            console.error('   Hãy đăng ký tài khoản trước rồi chạy lại script này.');
        } else {
            console.error('❌ Lỗi:', error.message);
        }
        process.exit(1);
    }
    process.exit(0);
}

main();
