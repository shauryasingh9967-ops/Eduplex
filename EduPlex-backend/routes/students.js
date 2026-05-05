const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

// ── GET /api/students ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let snapshot;

    if (req.user.role === 'student') {
      // Student sirf apna record dekhe — uid se match karo
      snapshot = await db.collection('students')
        .where('uid', '==', req.user.uid)
        .get();

      // FIX: Agar uid field nahi hai toh doc ID se try karo
      if (snapshot.empty) {
        const directDoc = await db.collection('students').doc(req.user.uid).get();
        if (directDoc.exists) {
          return res.json({
            success: true,
            count: 1,
            data: [{ id: directDoc.id, ...directDoc.data() }],
          });
        }
      }
    } else if (req.user.role === 'teacher') {
      // Teacher apne dept ke students dekhe
      // FIX: orderBy hata diya — Firestore composite index issue avoid
      snapshot = await db.collection('students')
        .where('dept', '==', req.user.dept)
        .get();
    } else {
      // Admin — sab students
      // FIX: orderBy hata diya — simple get() use karo
      snapshot = await db.collection('students').get();
    }

    const students = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return res.json({ success: true, count: students.length, data: students });
  } catch (err) {
    console.error('GET /students error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/students/:id ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('students').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const data = doc.data();

    // Student sirf apna data dekhe
    if (req.user.role === 'student') {
      const isOwn = data.uid === req.user.uid || doc.id === req.user.uid;
      if (!isOwn) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
    }

    return res.json({ success: true, data: { id: doc.id, ...data } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/students ─────────────────────────────────
router.post(
  '/',
  requireRole('admin'),
  [
    body('name').notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('dept').notEmpty().withMessage('Department required'),
    body('year').isInt({ min: 1, max: 6 }).withMessage('Year 1-6 hona chahiye'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, phone, dept, year, uid } = req.body;

    try {
      // Duplicate email check
      const existing = await db.collection('students').where('email', '==', email).get();
      if (!existing.empty) {
        return res.status(400).json({ success: false, message: 'Is email se student already exists.' });
      }

      // FIX: Agar uid diya hai toh use as doc ID — otherwise auto generate
      const studentRef = uid
        ? db.collection('students').doc(uid)
        : db.collection('students').doc();

      const studentData = {
        id:        studentRef.id,
        uid:       uid || studentRef.id,
        name,
        email,
        phone:     phone || '',
        dept,
        year:      parseInt(year),
        gpa:       0.0,
        status:    'Active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await studentRef.set(studentData);

      return res.status(201).json({
        success: true,
        message: `${name} added successfully.`,
        data: studentData,
      });
    } catch (err) {
      console.error('POST /students error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PUT /api/students/:id ──────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, email, phone, dept, year, gpa, status } = req.body;

  try {
    const docRef = db.collection('students').doc(req.params.id);
    const doc    = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (name   !== undefined) updates.name   = name;
    if (email  !== undefined) updates.email  = email;
    if (phone  !== undefined) updates.phone  = phone;
    if (dept   !== undefined) updates.dept   = dept;
    if (year   !== undefined) updates.year   = parseInt(year);
    if (gpa    !== undefined) updates.gpa    = parseFloat(gpa);
    if (status !== undefined) updates.status = status;

    await docRef.update(updates);

    return res.json({ success: true, message: 'Student updated.', data: { id: req.params.id, ...updates } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/students/:id ───────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('students').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    await db.collection('students').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Student deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/students/:id/summary ─────────────────────
router.get('/:id/summary', async (req, res) => {
  try {
    const stuDoc = await db.collection('students').doc(req.params.id).get();
    if (!stuDoc.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Attendance
    const attSnap = await db.collection('attendance')
      .where('studentId', '==', req.params.id)
      .get();

    const attRecords  = attSnap.docs.map(d => d.data());
    const total       = attRecords.length;
    const present     = attRecords.filter(a => a.status === 'Present').length;
    const late        = attRecords.filter(a => a.status === 'Late').length;
    const absent      = attRecords.filter(a => a.status === 'Absent').length;
    const attRate     = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

    // Marks
    const marksSnap = await db.collection('marks')
      .where('studentId', '==', req.params.id)
      .get();
    const marksData = marksSnap.docs.map(d => d.data());

    return res.json({
      success: true,
      data: {
        student:    { id: stuDoc.id, ...stuDoc.data() },
        attendance: { total, present, late, absent, rate: `${attRate}%` },
        marks:      marksData,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
