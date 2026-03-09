// api/webhook.js

module.exports = async function webhook(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).send("Webhook Running ✅");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log("STEP 1: request received");

    const data = req.body || {};
    console.log("STEP 2: body parsed", JSON.stringify(data));

    const JOUD_WORKFLOW_URL = process.env.JOUD_WORKFLOW_URL;
    console.log("STEP 3: workflow url exists =", !!JOUD_WORKFLOW_URL);
    console.log("STEP 4: workflow url =", JOUD_WORKFLOW_URL);

    if (!JOUD_WORKFLOW_URL) {
      return res.status(500).json({
        error: "missing_env",
        missing: "JOUD_WORKFLOW_URL",
      });
    }

    const payload = {
      phone: "201000997941",
      full_name: "محمود",
      short_id: "26023 (EQ)",
      address: "الرياض جدة",
      national_address: "غير متوفر",
      cart_items: [
        {
          quantity: 1,
          price: 99,
          product: {
            name: "مجفف الشعر الاصلي 5 في 1 بقوة 1000 واط",
          },
        },
      ],
      shipping_cost: 0,
      total_cost: 99,
      storeTag: "EQ",
      source: "vercel-test",
    };

    console.log("STEP 5: sending payload", JSON.stringify(payload));

    const joudRes = await fetch(JOUD_WORKFLOW_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log("STEP 6: joud status =", joudRes.status);

    const rawText = await joudRes.text();
    console.log("STEP 7: joud response =", rawText);

    return res.status(200).json({
      ok: true,
      status: joudRes.status,
      response: rawText,
    });
  } catch (err) {
    console.error("FATAL ERROR:", err);
    return res.status(500).json({
      error: "internal_error",
      details: err?.message || String(err),
    });
  }
};
