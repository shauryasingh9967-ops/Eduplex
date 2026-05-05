const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

// ── GET /api/teachers ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // FIX: orderBy hata diya — JS mein sort karo
    const snapshot = await db.collection('teachers').get();
    const teachers = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return res.json({ success: true, count: teachers.length, data: teachers });
  } catch (err) {
    console.error('GET /teachers error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/teachers/:id ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('teachers').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }
    return res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/teachers ─────────────────────────────────
router.post(
  '/',
  requireRole('admin'),
  [
    body('name').notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('dept').notEmpty().withMessage('Department required'),
    body('subject').notEmpty().withMessage('Subject required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, phone, dept, subject, exp, uid } = req.body;

    try {
      const existing = await db.collection('teachers').where('email', '==', email).get();
      if (!existing.empty) {
        return res.status(400).json({ success: false, message: 'Is email se teacher already exists.' });
      }

      // FIX: UID diya hai toh use as doc ID
      const ref  = uid ? db.collection('teachers').doc(uid) : db.collection('teachers').doc();
      const data = {
        id:        ref.id,
        uid:       uid || ref.id,
        name,
        email,
        phone:     phone   || '',
        dept,
        subject,
        exp:       parseInt(exp) || 0,
        role:      'teacher',
        status:    'Active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await ref.set(data);
      return res.status(201).json({ success: true, message: `${name} added.`, data });
    } catch (err) {
      console.error('POST /teachers error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PUT /api/teachers/:id ──────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, email, phone, dept, subject, exp, status } = req.body;

  try {
    const docRef = db.collection('teachers').doc(req.params.id);
    const doc    = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (name    !== undefined) updates.name    = name;
    if (email   !== undefined) updates.email   = email;
    if (phone   !== undefined) updates.phone   = phone;
    if (dept    !== undefined) updates.dept    = dept;
    if (subject !== undefined) updates.subject = subject;
    if (exp     !== undefined) updates.exp     = parseInt(exp);
    if (status  !== undefined) updates.status  = status;

    await docRef.update(updates);
    return res.json({ success: true, message: 'Teacher updated.', data: { id: req.params.id, ...updates } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/teachers/:id ───────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('teachers').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }
    await db.collection('teachers').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Teacher deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/teachers/:id/courses ─────────────────────
router.get('/:id/courses', async (req, res) => {
  try {
    const teacherDoc = await db.collection('teachers').doc(req.params.id).get();
    if (!teacherDoc.exists) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    const teacherName = teacherDoc.data().name;
    const snapshot    = await db.collection('courses').where('teacher', '==', teacherName).get();
    const courses     = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return res.json({ success: true, count: courses.length, data: courses });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
