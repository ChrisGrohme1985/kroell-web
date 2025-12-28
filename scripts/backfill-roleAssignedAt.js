/**
 * Script: roleAssignedAt für bestehende User nachpflegen
 *
 * 1) npm install firebase-admin
 * 2) node scripts/backfill-roleAssignedAt.js
 */

const admin = require("firebase-admin");
const path = require("path");

// ✅ Pfad zu deiner Service Account Datei
const serviceAccount = require(path.join(__dirname, "..", "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  console.log("🔍 Lade alle User aus /users …");

  const snap = await db.collection("users").get();

  if (snap.empty) {
    console.log("⚠️ Keine User gefunden.");
    return;
  }

  let updated = 0;

  for (const userDoc of snap.docs) {
    const data = userDoc.data();

    // ✅ Wenn roleAssignedAt schon existiert: überspringen
    if (data.roleAssignedAt) continue;

    // ✅ Wenn createdAt existiert, nutze createdAt, sonst "jetzt"
    const value = data.createdAt ? data.createdAt : admin.firestore.FieldValue.serverTimestamp();

    await userDoc.ref.update({
      roleAssignedAt: value,
    });

    updated++;
    console.log(`✅ ${userDoc.id}: roleAssignedAt gesetzt`);
  }

  console.log("🎉 Fertig.");
  console.log(`👉 Aktualisierte User: ${updated}`);
}

run().catch((err) => {
  console.error("❌ Fehler:", err);
  process.exit(1);
});
