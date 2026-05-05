const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { auth, db } = require('../firebase');
const { verifyToken, findUserInFirestore } = require('../middleware/auth');

// ── POST /api/auth/login ───────────────────────────────
// Frontend Firebase se idToken leke yahan bhejta hai
// FIX: Ab teeno collections mein user dhundta hai
router.post('/login', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'idToken required.' });
  }

  try {
    const decoded  = await auth.verifyIdToken(idToken);
    const userData = await findUserInFirestore(decoded.uid);

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: `Profile nahi mila. UID: ${decoded.uid} — Firestore mein document ID check karo.`,
      });
    }

    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        uid:    decoded.uid,
        email:  decoded.email,
        name:   userData.name   || '',
        role:   userData.role   || 'student',
        avatar: userData.avatar || (userData.name || '').slice(0, 2).toUpperCase(),
        dept:   userData.dept   || '',
        phone:  userData.phone  || '',
        status: userData.status || 'Active',
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(401).json({ success: false, message: 'Token invalid.', error: err.message });
  }
});

// ── POST /api/auth/register ────────────────────────────
// Admin naya user (teacher/student) banata hai
// FIX: Role ke hisab se sahi collection mein save karta hai
router.post(
  '/register',
  verifyToken,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
    body('name').notEmpty().withMessage('Name required'),
    body('role').isIn(['admin', 'teacher', 'student']).withMessage('Role: admin/teacher/student'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Sirf admin naye users bana sakta hai.' });
    }

    const { email, password, name, role, dept, phone, subject, exp, year } = req.body;

    try {
      // Firebase Auth mein user banao
      const userRecord = await auth.createUser({ email, password, displayName: name });
      const uid = userRecord.uid;
      const avatar = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

      // Role ke hisab se collection decide karo
      const collectionMap = { admin: 'users', teacher: 'teachers', student: 'students' };
      const col = collectionMap[role];

      // Base data jo sab ke liye common hai
      const baseData = {
        uid,
        name,
        email,
        role,
        dept:      dept  || '',
        phone:     phone || '',
        avatar,
        status:    'Active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Role-specific extra fields
      if (role === 'teacher') {
        baseData.subject = subject || '';
        baseData.exp     = parseInt(exp) || 0;
      }
      if (role === 'student') {
        baseData.year = parseInt(year) || 1;
        baseData.gpa  = 0.0;
      }

      // Document ID = Firebase Auth UID
      await db.collection(col).doc(uid).set(baseData);

      return res.status(201).json({
        success: true,
        message: `${name} (${role}) successfully registered.`,
        data: { uid, name, email, role },
      });
    } catch (err) {
      console.error('Register error:', err.message);
      if (err.code === 'auth/email-already-exists') {
        return res.status(400).json({ success: false, message: 'Ye email already registered hai.' });
      }
      return res.status(500).json({ success: false, message: 'Registration failed.', error: err.message });
    }
  }
);

// ── GET /api/auth/me ───────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
  return res.json({ success: true, data: req.user });
});

// ── PUT /api/auth/profile ──────────────────────────────
// FIX: Sahi collection mein update karta hai — sirf 'users' mein nahi
router.put('/profile', verifyToken, async (req, res) => {
  const { name, phone, dept } = req.body;

  try {
    const updates = { updatedAt: new Date().toISOString() };
    if (name  !== undefined) updates.name  = name;
    if (phone !== undefined) updates.phone = phone;
    if (dept  !== undefined) updates.dept  = dept;

    // Sahi collection mein update karo
    const col = req.user._col || 'users';
    await db.collection(col).doc(req.user.uid).update(updates);

    // Firebase Auth display name bhi update karo
    if (name) {
      await auth.updateUser(req.user.uid, { displayName: name }).catch(() => {});
    }

    return res.json({ success: true, message: 'Profile updated.', data: updates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/auth/user/:uid ─────────────────────────
// Admin kisi bhi user ko delete karta hai
router.delete('/user/:uid', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Sirf admin delete kar sakta hai.' });
  }

  try {
    // Firebase Auth se hatao
    await auth.deleteUser(req.params.uid).catch(() => {});

    // Teeno collections se hatao (jo bhi match kare)
    const cols = ['users', 'teachers', 'students'];
    for (const col of cols) {
      const snap = await db.collection(col).doc(req.params.uid).get();
      if (snap.exists) {
        await db.collection(col).doc(req.params.uid).delete();
        break;
      }
    }

    return res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
