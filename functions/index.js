const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();
const client = new MercadoPagoConfig({ accessToken: "APP_USR-390019337654474-042021-e3b83af756c2a4b04e78ad53573c4f2f-3141252060" });

exports.criarPagamento = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    // O SDK do Firebase no Frontend envia os dados dentro de "data"
    // Caso você use o httpsCallable, o body chega como { data: { ... } }
    const input = req.body.data || req.body; 

    const preference = new Preference(client);
    const body = {
      items: [{
        id: input.id,
        title: input.nome,
        quantity: 1,
        unit_price: Number(input.preco),
        currency_id: "BRL",
      }],
      external_reference: input.id,
      back_urls: {
        success: "https://v1lacerda.github.io/chadecozinha/agradecimento",
      },
      auto_return: "approved",
    };

    try {
      const result = await preference.create({ body });
      // Retornamos no formato que o httpsCallable espera receber
      res.status(200).send({ data: { init_point: result.init_point } });
    } catch (e) {
      console.error("Erro MP:", e);
      res.status(500).send({ data: { error: e.message } });
    }
  });
});

exports.webhookMP = functions.https.onRequest(async (req, res) => {
  const paymentId = req.query["data.id"] || (req.body.data && req.body.data.id);

  if (paymentId) {
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {"Authorization": `Bearer ${client.accessToken}`},
      });
      const paymentData = await response.json();

      if (paymentData.status === "approved") {
        const docId = paymentData.external_reference;
        
        // --- NOVIDADE: BUSCAR O NOME QUE VOCÊ SALVOU NO FIREBASE ---
        const docRef = db.collection("products").doc(docId);
        const docSnap = await docRef.get();
        const productData = docSnap.data();

        // Se existir um intent_by (nome que o convidado digitou), usamos ele. 
        // Caso contrário, tentamos o nome do MP ou "Convidado".
        const nomeFinal = productData.intent_by || paymentData.payer.first_name || "Convidado";
        const telefoneFinal = productData.intent_phone || "Não informado";

        await docRef.update({
          available: false,
          chosen_by: nomeFinal, // <--- Agora salva o nome real!
          chosen_phone: telefoneFinal,
          chosen_at: new Date().toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}),
          payment_id: paymentId,
        });

        // Enviar e-mail também com o nome correto
        // (Código do EmailJS aqui se você o configurou...)
      }
    } catch (err) {
      console.error("Erro no processamento do Webhook:", err);
    }
  }
  res.sendStatus(200);
});