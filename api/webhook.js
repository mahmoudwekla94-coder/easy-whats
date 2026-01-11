// api/webhook.js

module.exports = async function webhook(req, res) {
  // =========================
  // Health Check
  // =========================
  if (req.method === "GET") {
    return res.status(200).send("Webhook Running ✅");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = req.body || {};

    // =========================
    // Helpers
    // =========================
    const safeText = (t) => {
      if (!t) return "";
      return String(t)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    // =========================
    // Normalize Phone (Arabic Countries - E.164)
    // =========================
    function normalizePhone(phone, country = "KSA") {
      if (!phone) return "";

      let raw = String(phone).replace(/[^0-9]/g, "");

      // لو جاي بكود دولة بالفعل (بدون +)
      const knownCodes = [
        "966", "971", "20", "249", "967", "962", "965", "974", "973", "968",
        "964", "212", "213", "216", "218", "970", "961", "963", "222"
      ];

      for (const code of knownCodes) {
        if (raw.startsWith(code)) {
          return `+${raw}`;
        }
      }

      // ===== أرقام محلية بدون مفتاح =====

      // مصر: 01xxxxxxxxx -> +20 1xxxxxxxxx
      if (raw.startsWith("01") && raw.length === 11) {
        return `+20${raw.substring(1)}`;
      }

      // السودان: 09xxxxxxxx -> +249 9xxxxxxxx
      if (raw.startsWith("09") && raw.length === 10) {
        return `+249${raw.substring(1)}`;
      }

      // اليمن: 07xxxxxxx (9 أرقام) -> +967 7xxxxxxx
      if (raw.startsWith("07") && raw.length === 9) {
        return `+967${raw.substring(1)}`;
      }

      // الأردن: 07xxxxxxxx (10 أرقام) -> +962 7xxxxxxxx
      if (raw.startsWith("07") && raw.length === 10) {
        return `+962${raw.substring(1)}`;
      }

      // السعودية / الإمارات: 05xxxxxxxx (10 أرقام)
      if (raw.startsWith("05") && raw.length === 10) {
        if (country === "UAE") return `+971${raw.substring(1)}`;
        return `+966${raw.substring(1)}`; // Default KSA
      }

      // fallback
      return raw ? `+${raw}` : "";
    }

    // =========================
    // بيانات العميل
    // =========================
    const customerName =
      data.full_name ||
      data.name ||
      data.customer_name ||
      "عميلنا العزيز";

    const customerPhone =
      data.phone ||
      data.phone_alt ||
      data.customer_phone ||
      "";

    const orderId =
      data.short_id ||
      data.order_id ||
      data.id ||
      "";

    const country =
      data.country ||
      data.shipping_country ||
      "KSA";

    // =========================
    // رقم الهاتف
    // =========================
    const e164Phone = normalizePhone(customerPhone, country); // +2010...
    const digitsPhone = e164Phone.replace(/^\+/, "");         // 2010...

    if (!digitsPhone || digitsPhone.length < 9) {
      return res.status(400).json({
        error: "invalid_phone",
        input_phone: customerPhone,
        e164Phone,
        digitsPhone,
      });
    }

    // =========================
    // المنتج
    // =========================
    const firstItem = data.cart_items?.[0] || {};
    const productName = firstItem.product?.name || "منتج";
    const quantity = firstItem.quantity != null ? firstItem.quantity : 1;

    const priceRaw =
      firstItem.price ??
      data.total_cost ??
      data.cost ??
      0;

    // =========================
    // الشحن + الإجمالي
    // =========================
    const shippingRaw =
      data.shipping_cost ??
      data.shipping_fee ??
      data.shipping_price ??
      data.delivery_cost ??
      data.shipping ??
      data.delivery ??
      0;

    const priceNum =
      Number(String(priceRaw).replace(/[^0-9.]/g, "")) || 0;

    const shippingNum =
      Number(String(shippingRaw).replace(/[^0-9.]/g, "")) || 0;

    const shippingText =
      shippingNum > 0 ? `${shippingNum} ريال سعودي` : "مجاني";

    const totalNum =
      shippingNum > 0 ? priceNum + shippingNum : priceNum;

    const priceText =
      priceNum > 0 ? `${priceNum} ريال سعودي` : "غير محدد";

    const totalText = `${totalNum} ريال سعودي`;

    // =========================
    // العنوان التفصيلي + العنوان الوطني
    // =========================
    const detailedAddress =
      data.address ||
      data.full_address ||
      data.shipping_address ||
      data.address_text ||
      data.city ||
      "غير متوفر";

    const nationalAddressRaw =
      data.national_address ||
      data.short_address ||
      data.shortAddress ||
      data.address_short ||
      "";

    const nationalAddressClean = String(nationalAddressRaw).trim();

    const nationalAddress =
      nationalAddressClean
        ? nationalAddressClean
        : "غير متوفر (يرجى تزويدنا بالعنوان الوطني)";

    // =========================
    // ENV
    // =========================
    const API_BASE_URL = process.env.SAAS_API_BASE_URL;
    const VENDOR_UID = process.env.SAAS_VENDOR_UID;
    const API_TOKEN = process.env.SAAS_API_TOKEN;

    if (!API_BASE_URL || !VENDOR_UID || !API_TOKEN) {
      return res.status(500).json({ error: "missing_env" });
    }

    // =========================
    // Payload WhatsApp (مطابق لـ {{1}} → {{9}})
    // =========================
    const payload = {
      phone_number: digitsPhone,
      template_name: "ordar_confirmation",   // عدّل الاسم لو مختلف في المنصة
      template_language: "ar_EG",

      // {{1}} اسم العميل
      field_1: safeText(customerName),

      // {{2}} رقم الطلب
      field_2: safeText(orderId),

      // {{3}} اسم المنتج
      field_3: safeText(productName),

      // {{4}} الكمية
      field_4: safeText(quantity),

      // {{5}} السعر
      field_5: safeText(priceText),

      // {{6}} الشحن
      field_6: safeText(shippingText),

      // {{7}} الإجمالي
      field_7: safeText(totalText),

      // {{8}} العنوان التفصيلي
      field_8: safeText(detailedAddress),

      // {{9}} العنوان الوطني
      field_9: safeText(nationalAddress),

      contact: {
        first_name: safeText(customerName),
        phone_number: digitsPhone,
        country: "auto",
      },
    };

    const endpoint = `${API_BASE_URL}/${VENDOR_UID}/contact/send-template-message`;

    console.log("🚀 Sending Payload:", JSON.stringify(payload, null, 2));

    const saasRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await saasRes.json().catch(() => null);

    if (!saasRes.ok || responseData?.result === "failed") {
      console.error("❌ SaaS Error:", responseData);
      return res.status(500).json({
        error: "saas_error",
        details: responseData,
        debug_phone: { input: customerPhone, e164Phone, digitsPhone },
      });
    }

    console.log("✅ Success:", responseData);
    return res.status(200).json({
      status: "sent",
      data: responseData,
    });

  } catch (err) {
    console.error("❌ Webhook Crash:", err);
    return res.status(500).json({
      error: "internal_error",
      details: err?.message || String(err),
    });
  }
};
