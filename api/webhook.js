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

    // هل الطلب جاي من Shopify؟ (فيه line_items لكن مفيش cart_items)
    const isShopifyOrder =
      Array.isArray(data.line_items) &&
      data.line_items.length > 0 &&
      !data.cart_items;

    // =========================
    // Helpers
    // =========================
    const safeText = (t) => {
      if (!t && t !== 0) return "";

      return String(t)
        // 1) شيل أي \n أو \r أو \t مكتوبة كنص: "\n"
        .replace(/\\[nrt]/g, " ")
        // 2) شيل الـ newline / tab الفعليين
        .replace(/[\r\n\t]+/g, " ")
        // 3) قلل أي whitespace متكرر لمسافة واحدة
        .replace(/\s{2,}/g, " ")
        // 4) شيل المسافات من البداية والنهاية
        .trim();
    };

    // =========================
    // Store Tag Routing (EQ / BZ / GZ / SH)
    // =========================
    const storeTagRaw =
      (req.query && req.query.storeTag) ||
      data.storeTag ||
      data.tag ||
      "EQ";

    const storeTag = String(storeTagRaw).toUpperCase();

    // =========================
    // Store Config (نفس التمبلت لكل اللاندات)
    // =========================
    const storeConfig = {
      EQ: {
        template: "ordar_confirmation",
        lang: "ar_EG",
        currency: "ريال سعودي",
        defaultCountry: "KSA",
      },
      BZ: {
        template: "ordar_confirmation",
        lang: "ar_EG",
        currency: "ريال سعودي",
        defaultCountry: "KSA",
      },
      GZ: {
        template: "ordar_confirmation",
        lang: "ar_EG",
        currency: "ريال سعودي",
        defaultCountry: "KSA",
      },
      SH: {
        template: "ordar_confirmation",
        lang: "ar_EG",
        currency: "ريال سعودي",
        defaultCountry: "KSA",
      },
    };

    const cfg = storeConfig[storeTag] || storeConfig.EQ;

    // =========================
    // Normalize Phone (Arabic Countries - E.164)
    // =========================
    function normalizePhone(phone, country = "KSA") {
      if (!phone) return "";
      let raw = String(phone).replace(/[^0-9]/g, "");

      const knownCodes = [
        "966","971","20","249","967","962","965","974","973","968",
        "964","212","213","216","218","970","961","963","222"
      ];

      for (const code of knownCodes) {
        if (raw.startsWith(code)) return `+${raw}`;
      }

      // مصر: 01xxxxxxxxx -> +20 1xxxxxxxxx
      if (raw.startsWith("01") && raw.length === 11) return `+20${raw.substring(1)}`;
      // السودان: 09xxxxxxxx -> +249 9xxxxxxxx
      if (raw.startsWith("09") && raw.length === 10) return `+249${raw.substring(1)}`;
      // اليمن: 07xxxxxxx (9 أرقام) -> +967 7xxxxxxx
      if (raw.startsWith("07") && raw.length === 9)  return `+967${raw.substring(1)}`;
      // الأردن: 07xxxxxxxx (10 أرقام) -> +962 7xxxxxxxx
      if (raw.startsWith("07") && raw.length === 10) return `+962${raw.substring(1)}`;

      // السعودية / الإمارات: 05xxxxxxxx (10 أرقام)
      if (raw.startsWith("05") && raw.length === 10) {
        if (country === "UAE") return `+971${raw.substring(1)}`;
        return `+966${raw.substring(1)}`; // default KSA
      }

      return raw ? `+${raw}` : "";
    }

    // =========================
    // بيانات العميل + الطلب (EasyOrders VS Shopify)
    // =========================
    let customerName;
    let customerPhone;
    let orderId;
    let country;

    let firstItem = {};
    let priceRaw;
    let shippingRaw;
    let detailedAddress;
    let nationalAddressRaw;

    if (isShopifyOrder) {
      // 👇 طلب جاي من Shopify (Order Webhook)
      const shipping = data.shipping_address || {};
      const billing = data.billing_address || {};
      const lineItem = (data.line_items && data.line_items[0]) || {};

      customerName =
        (shipping.first_name || "") + " " + (shipping.last_name || "") ||
        shipping.name ||
        billing.name ||
        "عميلنا العزيز";

      customerPhone =
        shipping.phone ||
        data.phone ||
        (data.customer && data.customer.phone) ||
        data.customer_phone ||
        "";

      // رقم الطلب من Shopify (name بيبقى #1001 مثلاً)
      orderId =
        data.name ||        // مثل "#1001"
        data.order_number || // 1001
        data.id ||
        "";

      country =
        shipping.country_code ||
        shipping.country ||
        cfg.defaultCountry ||
        "KSA";

      firstItem = {
        product: { name: lineItem.title || "منتج" },
        quantity: lineItem.quantity != null ? lineItem.quantity : 1,
        price: lineItem.price || data.total_price || 0,
      };

      priceRaw =
        firstItem.price ??
        data.total_price ??
        0;

      const shippingLine = (data.shipping_lines && data.shipping_lines[0]) || {};
      shippingRaw =
        shippingLine.price ??
        (data.total_shipping_price_set &&
          data.total_shipping_price_set.shop_money &&
          data.total_shipping_price_set.shop_money.amount) ??
        0;

      detailedAddress = [
        shipping.address1,
        shipping.address2,
        shipping.city,
        shipping.province,
        shipping.zip,
      ]
        .filter(Boolean)
        .join(" - ");

      nationalAddressRaw = ""; // Shopify مش هيبعت national address
    } else {
      // 👇 طلب جاي من EasyOrders (الكود القديم)
      customerName =
        data.full_name ||
        data.name ||
        data.customer_name ||
        "عميلنا العزيز";

      customerPhone =
        data.phone ||
        data.phone_alt ||
        data.customer_phone ||
        "";

      orderId =
        data.short_id ||
        data.order_id ||
        data.id ||
        "";

      country =
        data.country ||
        data.shipping_country ||
        cfg.defaultCountry ||
        "KSA";

      firstItem = data.cart_items?.[0] || {};

      priceRaw =
        firstItem.price ??
        data.total_cost ??
        data.cost ??
        0;

      shippingRaw =
        data.shipping_cost ??
        data.shipping_fee ??
        data.shipping_price ??
        data.delivery_cost ??
        data.shipping ??
        data.delivery ??
        0;

      detailedAddress =
        data.address ||
        data.full_address ||
        data.shipping_address ||
        data.address_text ||
        data.city ||
        "غير متوفر";

      nationalAddressRaw =
        data.national_address ||
        data.short_address ||
        data.shortAddress ||
        data.address_short ||
        "";
    }

    // =========================
    // رقم الهاتف
    // =========================
    const e164Phone = normalizePhone(customerPhone, country);
    const digitsPhone = e164Phone.replace(/^\+/, "");

    if (!digitsPhone || digitsPhone.length < 9) {
      return res.status(400).json({
        error: "invalid_phone",
        input_phone: customerPhone,
        e164Phone,
        digitsPhone,
      });
    }

    // =========================
    // الكمية
    // =========================
    const quantity =
      firstItem.quantity != null ? firstItem.quantity : 1;

    // =========================
    // السعر + الشحن + الإجمالي
    // =========================
    const priceNum = Number(String(priceRaw).replace(/[^0-9.]/g, "")) || 0;
    const shippingNum = Number(String(shippingRaw).replace(/[^0-9.]/g, "")) || 0;

    const currencyLabel = cfg.currency;

    const shippingText = shippingNum > 0 ? `${shippingNum} ${currencyLabel}` : "مجاني";
    const totalNum = shippingNum > 0 ? priceNum + shippingNum : priceNum;
    const priceText = priceNum > 0 ? `${priceNum} ${currencyLabel}` : "غير محدد";
    const totalText = `${totalNum} ${currencyLabel}`;

    const productName = firstItem.product?.name || "منتج";

    const nationalAddress =
      String(nationalAddressRaw || "").trim() ||
      "غير متوفر (يرجى تزويدنا بالعنوان الوطني)";

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
    // Payload WhatsApp
    // =========================
    const payload = {
      phone_number: digitsPhone,
      template_name: cfg.template,     // ordar_confirmation
      template_language: cfg.lang,     // ar_EG

      // {{1}} اسم العميل
      field_1: safeText(customerName),

      // {{2}}:
      // لو الطلب من Shopify (storeTag = SH) نخليها "SH" بس
      // لو من EasyOrders نخليها زي ما كانت: رقم الطلب + التاج (EQ/BZ/GZ)
      field_2: safeText(
        storeTag === "SH"
          ? "SH"
          : `${orderId} (${storeTag})`
      ),

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

    console.log("🏪 Store:", storeTag, "| isShopifyOrder:", isShopifyOrder);
    console.log("🧩 Template:", cfg.template, "| Lang:", cfg.lang);
    console.log("🚀 Payload:", payload);

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

      console.error("🔍 Debug Fields:", {
        field_1: JSON.stringify(payload.field_1),
        field_2: JSON.stringify(payload.field_2),
        field_3: JSON.stringify(payload.field_3),
        field_4: JSON.stringify(payload.field_4),
        field_5: JSON.stringify(payload.field_5),
        field_6: JSON.stringify(payload.field_6),
        field_7: JSON.stringify(payload.field_7),
        field_8: JSON.stringify(payload.field_8),
        field_9: JSON.stringify(payload.field_9),
      });

      return res.status(500).json({
        error: "saas_error",
        details: responseData,
        storeTag,
      });
    }

    console.log("✅ Success:", responseData);
    return res.status(200).json({
      status: "sent",
      storeTag,
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
