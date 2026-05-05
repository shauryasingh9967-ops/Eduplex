const { auth, db } = require('../firebase');

// ── Helper: teeno collections mein user dhundo ─────────
// FIX: Pehle sirf 'users' collection check hoti thi
// Ab users → teachers → students teeno mein dhundta hai
async function findUserInFirestore(uid) {
  const collections = ['users', 'teachers', 'students'];

  for (const col of collections) {
    try {
      const snap = await db.collection(col).doc(uid).get();
      if (snap.exists) {
        return { ...snap.data(), _col: col };
      }
    } catch (err) {
      // Is collection mein nahi mila — agli try karo
      continue;
    }
  }
  return null;
}

// ── Verify Firebase ID Token ───────────────────────────
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token nahi mila. Pehle login karo.',
      });
    }

    const idToken = authHeader.split('Bearer ')[1].trim();

    // Firebase token verify karo
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Token invalid ya expire ho gaya. Dobara login karo.',
      });
    }

    // Firestore se user data lo (teeno collections mein dhundo)
    const userData = await findUserInFirestore(decoded.uid);

    if (!userData) {
      return res.status(401).json({
        success: false,
        message: `User profile nahi mila (UID: ${decoded.uid}). Firestore mein document check karo.`,
      });
    }

    // req.user set karo — saari routes mein available hoga
    req.user = {
      uid:    decoded.uid,
      email:  decoded.email || userData.email || '',
      role:   userData.role || 'student',
      name:   userData.name || '',
      dept:   userData.dept || '',
      phone:  userData.phone || '',
      avatar: userData.avatar || '',
      status: userData.status || 'Active',
      _col:   userData._col,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Auth check mein server error aaya.',
    });
  }
};

// ── Role Guard ─────────────────────────────────────────
// Usage: requireRole('admin') ya requireRole('admin', 'teacher')
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Login nahi kiya.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Ye kaam sirf ${roles.join(' ya ')} kar sakta hai.`,
      });
    }
    next();
  };
};

module.exports = { verifyToken, requireRole, findUserInFirestore };
