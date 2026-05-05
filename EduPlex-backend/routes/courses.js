const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

// ── GET /api/courses ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { dept } = req.query;

    // FIX: where + orderBy combo composite index maangta hai — hata diya
    let snapshot;
    if (dept) {
      snapshot = await db.collection('courses').where('dept', '==', dept).get();
    } else {
      snapshot = await db.collection('courses').get();
    }

    const courses = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return res.json({ success: true, count: courses.length, data: courses });
  } catch (err) {
    console.error('GET /courses error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/courses/:id ───────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('courses').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    return res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/courses ──────────────────────────────────
router.post(
  '/',
  requireRole('admin'),
  [
    body('name').notEmpty().withMessage('Course name required'),
    body('dept').notEmpty().withMessage('Department required'),
    body('teacher').notEmpty().withMessage('Teacher required'),
    body('credits').isInt({ min: 1, max: 6 }).withMessage('Credits 1-6'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, dept, teacher, credits, capacity, description } = req.body;

    try {
      const ref  = db.collection('courses').doc();
      const data = {
        id:          ref.id,
        name,
        dept,
        teacher,
        credits:     parseInt(credits),
        capacity:    parseInt(capacity),
        enrolled:    0,
        status:      'Active',
        description: description || '',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      };

      await ref.set(data);
      return res.status(201).json({ success: true, message: `${name} created.`, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── PUT /api/courses/:id ───────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, dept, teacher, credits, capacity, enrolled, status, description } = req.body;

  try {
    const docRef = db.collection('courses').doc(req.params.id);
    const doc    = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    const current = doc.data();
    const updates = { updatedAt: new Date().toISOString() };

    if (name        !== undefined) updates.name        = name;
    if (dept        !== undefined) updates.dept        = dept;
    if (teacher     !== undefined) updates.teacher     = teacher;
    if (credits     !== undefined) updates.credits     = parseInt(credits);
    if (capacity    !== undefined) updates.capacity    = parseInt(capacity);
    if (enrolled    !== undefined) updates.enrolled    = parseInt(enrolled);
    if (description !== undefined) updates.description = description;
    if (status      !== undefined) updates.status      = status;

    // Auto status update
    const newEnrolled = enrolled !== undefined ? parseInt(enrolled) : current.enrolled;
    const newCapacity = capacity !== undefined ? parseInt(capacity) : current.capacity;
    if (status === undefined) {
      updates.status = newEnrolled >= newCapacity ? 'Full' : 'Active';
    }

    await docRef.update(updates);
    return res.json({ success: true, message: 'Course updated.', data: { id: req.params.id, ...updates } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/courses/:id ────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('courses').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    await db.collection('courses').doc(req.params.id).delete();
    return res.json({ success: true, message: 'Course deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/courses/:id/enroll ───────────────────────
router.post('/:id/enroll', requireRole('admin', 'student'), async (req, res) => {
  const { studentId } = req.body;

  try {
    const courseRef = db.collection('courses').doc(req.params.id);
    const courseDoc = await courseRef.get();
    if (!courseDoc.exists) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    const course = courseDoc.data();
    if (course.enrolled >= course.capacity) {
      return res.status(400).json({ success: false, message: 'Course full hai.' });
    }

    const existing = await db.collection('enrollments')
      .where('studentId', '==', studentId)
      .where('courseId', '==', req.params.id)
      .get();

    if (!existing.empty) {
      return res.status(400).json({ success: false, message: 'Student already enrolled hai.' });
    }

    const enrollRef = db.collection('enrollments').doc();
    await enrollRef.set({
      id:         enrollRef.id,
      studentId,
      courseId:   req.params.id,
      courseName: course.name,
      enrolledAt: new Date().toISOString(),
    });

    await courseRef.update({ enrolled: (course.enrolled || 0) + 1 });
    return res.status(201).json({ success: true, message: 'Enrolled successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/courses/:id/students ─────────────────────
router.get('/:id/students', requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const snapshot    = await db.collection('enrollments').where('courseId', '==', req.params.id).get();
    const enrollments = snapshot.docs.map(d => d.data());
    return res.json({ success: true, count: enrollments.length, data: enrollments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
