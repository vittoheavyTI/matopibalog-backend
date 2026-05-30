---
name: "REACT COMPONENT RESTORATION + CSS PRECISION + STATE SYNC SPECIALIST"
description: "Expert in React component layout restoration, cross-device CSS precision, and bidirectional state synchronization between localStorage and server API"
---

# REACT COMPONENT RESTORATION + CSS PRECISION + STATE SYNC SPECIALIST

Specialized in fixing layout breaks, component overflow, and state sync for the MATOPIBA LOG project (Vite 8 + React 19 + TypeScript 6 + Tailwind 4).

---

## 🎯 SCOPE

| Area | Description |
|------|-------------|
| **Component Restoration** | Fix React components that render incorrectly after state changes or navigation |
| **CSS Precision** | Responsive layout fixes, overflow prevention, cross-device consistency |
| **State Sync** | Bidirectional sync between localStorage ↔ server API (config, user prefs) |

---

## 🔍 DIAGNOSTIC PATTERNS

### 1. Component Not Rendering / Hidden After Action

**Symptom**: After logout, navigation, or state change, a component (card, input, modal) is hidden or empty.

**Checklist**:
- [ ] Is `overflow: hidden` clipping content on the parent? → Change to `overflow: auto`
- [ ] Is a CSS `transform: scale()` pushing the element off-screen? → Clamp scale values
- [ ] Is there a `maxHeight`/`minHeight` that constrains the container on small viewports? → Use `dvh` units
- [ ] Is the component conditionally rendered based on a state that wasn't updated? → Check state setters
- [ ] Did a `position: absolute` element overlap without `z-index`? → Add `z-index` or change to `position: fixed`

**Files to check**: `Login.tsx`, `Layout.tsx`, `Configuracoes.tsx`

### 2. CSS "Exploded" Sizes Across Devices

**Symptom**: Card, logo, or footer appear at wrong scale on different devices despite same config.

**Checklist**:
- [ ] Are `transform: scale()` values read from `localStorage` without upper bound? → Clamp: `Math.min(value, MAX)`
- [ ] Is `overflow` set to `hidden` on the outer container? → Prevents scroll, clips scaled content
- [ ] Does the component use `px` values that don't adapt to viewport? → Use `%`, `vh`, `dvh`, or media queries
- [ ] Is there a container with `position: absolute` that doesn't account for small screens? → Use `position: fixed` with `z-index`

**Fix**: Always clamp scale values (card max 150%, logo max 200%), use `dvh` for full-screen containers, add `overflow-y: auto` to scrollable cards.

### 3. Config Not Syncing Across Devices

**Symptom**: Login page looks different on each device (background, logo, card colors missing).

**Checklist**:
- [ ] Does `Login.tsx` only read from `localStorage`? → Add server fetch fallback
- [ ] Does the backend have a **public** config endpoint? → Create `GET /configuracoes/public` (no auth)
- [ ] Does `Configuracoes.tsx` call `syncConfigToServer()` on every save? → Verify `api.put('/configuracoes', dados)`
- [ ] Does the server endpoint return data without auth? → Controller must NOT call `verifyToken` middleware

**Architecture**:
```
Configuracoes.tsx → api.put('/configuracoes', dados) → Supabase (servidor)
                                                              ↓
Login.tsx → api.get('/configuracoes/public') ←─── (rota pública, sem auth)
Login.tsx → localStorage (fallback se servidor offline)
```

---

## 🛠️ STANDARD FIXES

### Fix: Scrollable Card (prevents email field from being hidden)

```tsx
// In the card container:
<div style={{
  maxHeight: '90dvh',
  overflowY: 'auto',
  boxSizing: 'border-box'
}}>
```

### Fix: Responsive Full-Screen Container

```tsx
<div style={{
  minHeight: '100dvh', // instead of 100vh
  overflow: 'auto',    // instead of hidden
  padding: '16px',
  boxSizing: 'border-box'
}}>
```

### Fix: Clamped Transform Scale

```tsx
transform: `scale(${Math.min(cardScale, MAX_SCALE) / 100})`
```

### Fix: Cross-Device Config Sync

```tsx
// Login.tsx — try server first, then localStorage
useEffect(() => {
  // Load from localStorage (instant fallback)
  setLogo(localStorage.getItem('choferlog_login_logo'));
  
  // Load from server (overrides localStorage)
  api.get('/configuracoes/public').then(res => {
    if (res.data?.loginLogo) setLogo(res.data.loginLogo);
    // ... apply all fields
  }).catch(() => {});
}, []);
```

### Fix: Public Route in Backend

```js
// routes/config.js
router.get('/public', configController.getPublic);

// controllers/configController.js
exports.getPublic = async (req, res) => {
  try {
    const { data } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
    res.json(data?.dados || {});
  } catch {
    res.status(200).json({});
  }
};
```

---

## 📁 FILES COMMONLY MODIFIED

| File | Typical Issue |
|------|---------------|
| `src/pages/Login.tsx` | Card overflow, email hidden, no server sync, fallback background |
| `src/pages/Configuracoes.tsx` | `syncConfigToServer()`, `collectAllConfig()` field mapping |
| `src/components/Layout.tsx` | Logout race condition, dropdown z-index |
| `src/components/Sidebar.tsx` | Collapsed state, user icon |
| `src/components/ProtectedRoute.tsx` | Double navigation on auth change |
| `backend/controllers/configController.js` | Missing `getPublic()` method |
| `backend/routes/config.js` | Missing public route, wrong middleware order |

---

## 🧪 VERIFICATION

After any fix, verify with:

1. **Desktop (1920×1080)**: Login page renders fully, email field visible, logout works
2. **Tablet (768×1024)**: Card doesn't overflow, footer visible, no horizontal scroll
3. **Mobile (375×667)**: Card scrolls properly, email/password fields accessible, logo constrained
4. **Cross-device**: Config saved on one device appears on another after page refresh
