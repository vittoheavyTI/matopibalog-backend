const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.aprovarMotorista = functions.https.onCall(async (data, context) => {
  // Verifica se quem está chamando é um admin
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Apenas administradores podem aprovar motoristas."
    );
  }

  const { motoristaUid } = data;
  if (!motoristaUid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "O uid do motorista é obrigatório."
    );
  }

  try {
    // 1. Define a custom claim admin: false
    await admin.auth().setCustomUserClaims(motoristaUid, { admin: false });

    // 2. Atualiza o status no banco (tabela motoristas)
    await admin.firestore().collection("motoristas").doc(motoristaUid).update({
      statusCadastro: "aprovado",
    });

    // 3. Atualiza o status na tabela usuarios (opcional, manter em sincronia)
    await admin.firestore().collection("usuarios").doc(motoristaUid).update({
      status: "ativo",
    });

    return { success: true, message: "Motorista aprovado com sucesso." };
  } catch (error) {
    console.error("Erro ao aprovar motorista:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

exports.tornarAdmin = functions.https.onCall(async (data, context) => {
  // Apenas outro admin pode dar privilégios de admin
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Apenas administradores podem promover outros a admin."
    );
  }

  const { targetUid } = data;
  if (!targetUid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "O uid do alvo é obrigatório."
    );
  }

  try {
    await admin.auth().setCustomUserClaims(targetUid, { admin: true });
    
    // Atualiza a flag na collection de usuarios se existir
    await admin.firestore().collection("usuarios").doc(targetUid).update({
      tipo: "admin",
      status: "ativo"
    }, { merge: true });

    return { success: true, message: "Usuário promovido a admin com sucesso." };
  } catch (error) {
    console.error("Erro ao tornar admin:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

exports.criarAdminBackend = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Apenas administradores podem criar novos admins."
    );
  }

  const { email, senha, nome } = data;
  if (!email || !senha || !nome) {
    throw new functions.https.HttpsError("invalid-argument", "Dados incompletos.");
  }

  try {
    const userRecord = await admin.auth().createUser({
      email: email,
      password: senha,
      displayName: nome,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });

    await admin.firestore().collection("usuarios").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      nome: nome,
      tipo: "admin",
      status: "ativo",
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error("Erro ao criar admin:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});
