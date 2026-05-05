const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
        // \n ko actual newline mein convert karo
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        clientId:    process.env.FIREBASE_CLIENT_ID,
      }),
    });
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
    process.exit(1);
  }
}

const db   = admin.firestore();
const auth = admin.auth();

// Undefined values Firestore mein error deta hai — ignore karo
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db, auth };
