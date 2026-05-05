const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db } = require('../firebase');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

// ── POST /api/attendance/mark ──────────────────────────
router.post(
  '/mark',
  requireRole('admin', 'teacher'),
  [
    body('courseId').notEmpty().withMessage('courseId required'),
    body('date').notEmpty().withMessage('date required (YYYY-MM-DD)'),
    body('records').isArray({ min: 1 }).withMessage('records array required'),
    body('records.*.studentId').notEmpty().withMessage('studentId required'),
    body('records.*.status').isIn(['Present', 'Absent', 'Late']).withMessage('Status: Present/Absent/Late'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { courseId, date, records } = req.body;

    try {
      // FIX: Duplicate check simple rakhha — composite index avoid
      const existing = await db.collection('attendance')
        .where('courseId', '==', courseId)
        .where('date', '==', date)
        .limit(1)
        .get();

      if (!existing.empty) {
        // Already marked — update karo instead of error
        // Har record update karo
        const batch = db.batch();
        for (const record of records) {
          const snap = await db.collection('attendance')
            .where('courseId', '==', courseId)
            .where('date', '==', date)
            .where('studentId', '==', record.studentId)
            .limit(1)
            .get();

          if (!snap.empty) {
            batch.update(snap.docs[0].ref, {
              status:    record.status,
              updatedBy: req.user.uid,
              updatedAt: new Date().toISOString(),
            });
          } else {
            const newRef = db.collection('attendance').doc();
            batch.set(newRef, {
              id:        newRef.id,
              courseId,
              date,
              studentId: record.studentId,
              status:    record.status,
              markedBy:  req.user.uid,
              markedAt:  new Date().toISOString(),
            });
          }
        }
        await batch.commit();
        return res.json({
          success: true,
          message: `Attendance updated for ${records.length} students.`,
        });
      }

      // Fresh attendance mark karo
      const batch = db.batch();
      for (const record of records) {
        const ref = db.collection('attendance').doc();
        batch.set(ref, {
          id:        ref.id,
          courseId,
          date,
          studentId: record.studentId,
          status:    record.status,
          markedBy:  req.user.uid,
          markedAt:  new Date().toISOString(),
        });
      }
      await batch.commit();

      const summary = {
        total:   records.length,
        present: records.filter(r => r.status === 'Present').length,
        absent:  records.filter(r => r.status === 'Absent').length,
        late:    records.filter(r => r.status === 'Late').length,
      };

      return res.status(201).json({
        success: true,
        message: `Attendance marked for ${records.length} students.`,
        summary,
      });
    } catch (err) {
      console.error('POST /attendance/mark error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ── GET /api/attendance/student/:studentId ─────────────
router.get('/student/:studentId', async (req, res) => {
  const { studentId } = req.params;

  // Student sirf apna data dekhe
  if (req.user.role === 'student') {
    const isOwn = req.user.uid === studentId;
    if (!isOwn) {
      // studentId se actual doc check karo
      const stuDoc = await db.collection('students').doc(studentId).get();
      if (!stuDoc.exists || stuDoc.data().uid !== req.user.uid) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
    }
  }

  try {
    // FIX: orderBy hata diya — JS mein sort karo
    const snapshot = await db.collection('attendance')
      .where('studentId', '==', studentId)
      .get();

    const records = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Course-wise summary
    const courseMap = {};
    records.forEach(r => {
      if (!courseMap[r.courseId]) {
        courseMap[r.courseId] = { courseId: r.courseId, total: 0, present: 0, absent: 0, late: 0 };
      }
      courseMap[r.courseId].total++;
      courseMap[r.courseId][r.status.toLowerCase()]++;
    });

    const courseSummary = Object.values(courseMap).map(c => ({
      ...c,
      rate: `${Math.round(((c.present + c.late) / c.total) * 100)}%`,
    }));

    const overall = {
      total:   records.length,
      present: records.filter(r => r.status === 'Present').length,
      absent:  records.filter(r => r.status === 'Absent').length,
      late:    records.filter(r => r.status === 'Late').length,
    };
    overall.rate = overall.total > 0
      ? `${Math.round(((overall.present + overall.late) / overall.total) * 100)}%`
      : '0%';

    return res.json({ success: true, data: { records, overall, courseSummary } });
  } catch (err) {
    console.error('GET /attendance/student error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/attendance/course/:courseId ───────────────
router.get('/course/:courseId', requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { date } = req.query;
    let query = db.collection('attendance').where('courseId', '==', req.params.courseId);
    if (date) query = query.where('date', '==', date);

    const snapshot = await query.get();
    const records  = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/attendance/report ─────────────────────────
router.get('/report', requireRole('admin'), async (req, res) => {
  try {
    const snapshot = await db.collection('attendance').get();
    const all      = snapshot.docs.map(d => d.data());

    const total   = all.length;
    const present = all.filter(a => a.status === 'Present').length;
    const absent  = all.filter(a => a.status === 'Absent').length;
    const late    = all.filter(a => a.status === 'Late').length;
    const rate    = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

    const courseMap = {};
    all.forEach(a => {
      if (!courseMap[a.courseId]) courseMap[a.courseId] = { total: 0, present: 0, absent: 0, late: 0 };
      courseMap[a.courseId].total++;
      courseMap[a.courseId][a.status.toLowerCase()]++;
    });

    return res.json({
      success: true,
      data: {
        overall:   { total, present, absent, late, rate: `${rate}%` },
        perCourse: courseMap,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
