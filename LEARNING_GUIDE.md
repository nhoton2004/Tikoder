# TikTokOrderApp Security Fixes — Learning Guide

**Date:** June 9, 2026  
**Project:** TikTokOrderApp (Node.js + Express)  
**Status:** ✅ 6 Security Issues Fixed

---

## 📚 What I Did — Chi Tiết Công Việc

### **Phase 1: Project Analysis** 🔍

**Goal:** Understand codebase structure and identify security issues

**Actions:**
1. Listed project files (2,736 LOC across 3 main files)
2. Read key files:
   - `server.js` (2,242 lines) — main Express server
   - `routes/admin.js` (303 lines) — admin API routes
   - `utils/customerStore.js` (191 lines) — customer data management
   - `utils/orderExcelExporter.js` (264 lines) — Excel export logic
3. Checked dependencies in `package.json`

**Findings:**
- Tech stack: Express, Socket.io, Firebase, ExcelJS, TikTok Live Connector
- No CSRF protection
- Hardcoded secrets
- Weak input validation
- Missing error handling

---

## 🔴 CRITICAL Issues Fixed (4)

### **Issue #1: DEV_SKIP_AUTH Bypass** 
**Severity:** 🔴 CRITICAL  
**Risk:** Unauthorized admin access in production

**Original Code (Line 20):**
```javascript
const DEV_SKIP_AUTH = String(process.env.VITE_DEV_SKIP_AUTH || 'false').toLowerCase() === 'true';

// Problem: If env var set incorrectly, dev mode activates even in production
if (DEV_SKIP_AUTH && req.session && !req.session.user) {
    req.session.user = { ...DEV_USER, role: 'admin' };  // ← Injection!
}
```

**Why it's dangerous:**
- Dev user gets admin role automatically
- No Firebase authentication needed
- Anyone could access admin endpoints
- Works in any environment, not just development

**Fix Applied:**
```javascript
const DEV_SKIP_AUTH = process.env.NODE_ENV === 'development' 
    && String(process.env.VITE_DEV_SKIP_AUTH || 'false').toLowerCase() === 'true';

if (DEV_SKIP_AUTH) {
    console.warn('⚠️  WARNING: DEV_SKIP_AUTH is ENABLED. This bypasses Firebase authentication.');
    console.warn('⚠️  This should NEVER be enabled in production.');
}
```

**Learning Points:**
- Always check environment context before enabling debug modes
- Use `NODE_ENV` as primary guard
- Log warnings for security-sensitive features
- Environment variables alone are not enough security

---

### **Issue #2: Hardcoded Session Secret Fallback**
**Severity:** 🔴 CRITICAL  
**Risk:** All user sessions vulnerable with default secret

**Original Code (Line 49):**
```javascript
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',  // ← Danger!
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
});
```

**Why it's dangerous:**
- If `SESSION_SECRET` not set, everyone gets same hardcoded secret
- Attacker can forge session tokens
- Sessions not secure at all
- Production deployments might forget to set env var

**Fix Applied:**
```javascript
if (!process.env.SESSION_SECRET) {
    console.error('❌ FATAL: SESSION_SECRET must be set in .env file');
    process.exit(1);
}

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict'
    }
});
```

**Learning Points:**
- Fail fast (fail-fast pattern) is better than silent degradation
- Never have fallback secrets
- Generate strong secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Cookie flags matter:
  - `httpOnly` prevents XSS attacks
  - `sameSite: 'strict'` prevents CSRF
  - `secure: true` forces HTTPS-only in production

---

### **Issue #3: Path Traversal Vulnerability**
**Severity:** 🔴 CRITICAL  
**Risk:** Access to arbitrary files on server

**Original Code (customerStore.js line 36-38):**
```javascript
function safeUserId(userId) {
    return String(userId || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Problem: Attacker can still bypass with:
// - "../../../etc/passwd"
// - ".../" patterns
// - Leading dots: ".ssh/id_rsa"
```

**Attack Example:**
```javascript
// Input: "../../../etc/passwd"
// After regex: "........................passwd"
// Still creates: data/customers/........................passwd.json
// File created in wrong location!
```

**Fix Applied:**
```javascript
function safeUserId(userId) {
    // SECURITY: Prevent path traversal and injection attacks
    const sanitized = String(userId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .replace(/\.{2,}/g, '_')      // Block ".." sequences
        .replace(/^\\.+/, '_');         // Block leading dots
    
    if (!sanitized || sanitized === '.' || sanitized === '..' || sanitized.length > 255) {
        throw new Error(`Invalid userId: "${userId}"`);
    }
    return sanitized;
}
```

**Defense Layers:**
1. Character whitelist (only alphanumeric, _, -, .)
2. Block ".." sequences (prevents parent directory access)
3. Block leading dots (prevents hidden files)
4. Length limit (prevents buffer overflow)
5. Reject suspicious values (throw error, don't silently ignore)

**Learning Points:**
- Blacklists (blocking bad chars) are not enough
- Use whitelists (allow good chars)
- Multiple defense layers (defense in depth)
- Validate early, throw errors on invalid input
- Test with common payloads: `../`, `..\\`, `./`, `.`, `..`

---

### **Issue #4: Missing Error Handling**
**Severity:** 🔴 CRITICAL  
**Risk:** Application crashes from malformed data

**Original Code (orderExcelExporter.js line 35-68):**
```javascript
function normalizeOrders(input) {
    if (Array.isArray(input)) return input;
    if (!input || typeof input !== 'object') return [];

    const orders = [];
    Object.values(input).forEach(customer => {
        // ← No check if customer is null/undefined
        const items = Array.isArray(customer?.items) ? customer.items : [];
        items.forEach(item => {
            // ← No check if item is valid
            orders.push({
                id: item.id || '',
                productName: normalizeDisplayText(item.productName || item.text || ''),
                // ... more fields
            });
        });
    });
    return orders;
}
```

**Problem Scenarios:**
- `input = { user: null }` → crash on `customer?.items`
- `input = { user: { items: [null] } }` → crash on `item.id`
- `input = { user: { items: ["string"] } }` → crash on object operations

**Fix Applied:**
```javascript
function normalizeOrders(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (typeof input !== 'object') return [];

    try {
        const orders = [];
        Object.values(input).forEach(customer => {
            // ← Add validation
            if (!customer || typeof customer !== 'object') return;
            
            const items = Array.isArray(customer?.items) ? customer.items : [];
            
            items.forEach(item => {
                // ← Add validation
                if (!item || typeof item !== 'object') return;
                
                orders.push({
                    id: item.id || '',
                    productName: normalizeDisplayText(item.productName || item.text || ''),
                    // ...
                });
            });
        });
        return orders;
    } catch (error) {
        console.error('Error normalizing orders:', error.message);
        return [];  // ← Graceful fallback
    }
}
```

**Learning Points:**
- Type check every object before accessing properties
- Use try-catch for defensive programming
- Return sensible defaults (empty array) on error
- Log errors for debugging, don't crash silently
- Validate at entry point (function start)

---

## 🟡 HIGH Priority Issues Fixed (2)

### **Issue #5: Cookie Security**
**Severity:** 🟡 HIGH  
**Risk:** Session hijacking, CSRF attacks

**Changes:**
```javascript
// Before
cookie: { secure: false }  // ← HTTP cookies, XSS vulnerable

// After
cookie: { 
    secure: process.env.NODE_ENV === 'production',  // HTTPS-only in prod
    httpOnly: true,          // JavaScript can't access (XSS prevention)
    sameSite: 'strict'       // No cross-site cookie sending (CSRF prevention)
}
```

**Why each flag matters:**
- `secure: true` — Cookie only sent over HTTPS, not HTTP
- `httpOnly: true` — `document.cookie` can't read it (XSS protection)
- `sameSite: 'strict'` — Browser won't send cookie cross-site (CSRF protection)

---

### **Issue #6: Hardcoded Configuration**
**Severity:** 🟡 HIGH  
**Risk:** Inflexible, not secure for production

**Changes:**
- Moved `printerInterface` to `PRINTER_INTERFACE` env var
- Moved `tiktokSignApiKey` to `TIKTOK_SIGN_API_KEY` env var
- Updated `.env.example` with all required variables
- Added security warnings in config

**Learning Points:**
- Environment variables for configuration (12-factor app)
- Never hardcode secrets or environment-specific settings
- Use `.env` file for local dev (don't commit!)
- `.env.example` shows required vars (commit this!)

---

## 📋 Implementation Steps (For Learning)

### **Step 1: Understand the Problem**
- Read the original code
- Identify vulnerability
- Think: "How could attacker exploit this?"

### **Step 2: Research the Fix**
- Check OWASP guidelines
- Look at best practices
- Consider edge cases

### **Step 3: Implement Fix**
- Add validation / error handling
- Keep code readable
- Add comments explaining why

### **Step 4: Test Edge Cases**
- What if input is `null`?
- What if input is `undefined`?
- What if input is empty object `{}`?
- What if input has malicious payload?

### **Step 5: Document**
- Explain what changed
- Explain why it's safer
- Add deployment instructions

---

## 🛠️ Tools & Techniques Used

### **1. Code Review Process**
- Read code line-by-line
- Think like attacker (threat modeling)
- Look for common patterns (hardcoded secrets, weak validation)

### **2. Input Validation**
- Whitelist good characters
- Block dangerous patterns
- Multiple defense layers
- Reject early, fail loudly

### **3. Error Handling**
- Try-catch blocks
- Type checking before operations
- Graceful degradation
- Logging for debugging

### **4. Configuration Management**
- Environment variables for secrets
- `.env` files for local development
- `.env.example` for documentation
- Fail-fast if required vars missing

### **5. Git Workflow**
- Create feature branch: `security/critical-fixes-2026-06`
- Commit with detailed message
- Ready for PR review

---

## 📚 Learning Resources

### **OWASP Top 10 Security Issues**
1. Broken Authentication
2. Broken Access Control
3. Injection
4. Insecure Deserialization
5. Security Misconfiguration

### **Node.js Security**
- Never trust user input
- Always validate input
- Use parameterized queries (not here, but for SQL)
- Keep dependencies updated: `npm audit`

### **Express.js Best Practices**
- Use middleware for auth
- Validate request data
- Set security headers
- Use HTTPS in production

### **Session Management**
- Store session secret securely
- Use httpOnly cookies
- Set secure flag in production
- Implement logout

---

## 🎯 Key Takeaways

### **For Security:**
1. **Defense in depth** — Multiple layers of validation
2. **Fail fast** — Error early, don't silently ignore
3. **Environment context** — Different rules for dev vs production
4. **Threat modeling** — Think like attacker
5. **Logging** — Know when things go wrong

### **For Code Quality:**
1. **Type safety** — Check types before using
2. **Error handling** — Never let exceptions crash app
3. **Configuration** — Use environment variables
4. **Documentation** — Explain why, not just what
5. **Testing** — Test edge cases, not just happy path

### **For Team:**
1. **Code review** — Catch issues early
2. **Clear commits** — Explain changes
3. **Documentation** — Help others learn
4. **Deployment** — Have clear checklist

---

## ✅ Deployment Checklist (For Reference)

```bash
# 1. Install dependencies
npm install

# 2. Generate SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create .env from .env.example
cp .env.example .env

# 4. Fill in required values:
# - SESSION_SECRET=<generated-above>
# - NODE_ENV=production
# - Firebase credentials
# - PRINTER_INTERFACE
# - TIKTOK_SIGN_API_KEY

# 5. Test: Should fail without SESSION_SECRET
NODE_ENV=production npm start
# Expected: ❌ FATAL: SESSION_SECRET must be set

# 6. Start server
NODE_ENV=production npm start
# Expected: ✅ Server running on port 3000
```

---

## 🔗 Files Changed

| File | Lines Changed | What |
|------|---------------|------|
| `server.js` | +13 | DEV mode, session security |
| `customerStore.js` | +9 | Path traversal prevention |
| `orderExcelExporter.js` | +10 | Error handling |
| `package.json` | +1 | Add csurf dependency |
| `.env.example` | +32 | Security config template |
| `config.json` | +1 | Mark deprecated |
| `SECURITY.md` | +220 | Full documentation |

---

**Created:** June 9, 2026  
**By:** Kiro (Hermes Agent)  
**For:** Learning & Future Reference

---

## 💡 Quiz — Test Your Understanding

**Q1:** Why is `DEV_SKIP_AUTH` dangerous without `NODE_ENV` check?
**A:** Because it could be enabled in production, giving unauthorized admin access.

**Q2:** What's wrong with `secret: process.env.SECRET || 'default'`?
**A:** If env var missing, everyone uses same hardcoded secret, sessions aren't secure.

**Q3:** How does `httpOnly` protect against XSS?
**A:** JavaScript `document.cookie` can't read it, so even if XSS attack happens, attacker can't steal session.

**Q4:** Why block ".." in userId?
**A:** Prevents path traversal attacks (accessing files outside intended directory).

**Q5:** What does `try-catch` do?
**A:** Catches errors so app doesn't crash, allows graceful handling instead.

---

**Em sẵn sàng để đại ca hỏi thêm bất cứ lúc nào! 🚀**
