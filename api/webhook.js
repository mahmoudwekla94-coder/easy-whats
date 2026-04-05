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

    // هل الطلب جاي من Shopify؟
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
        .replace(/\\[nrt]/g, " ")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    const toNumber = (v) =>
      Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0;

    // Normalize Phone (E.164)
    function normalizePhone(phone) {
      if (!phone) return "";

      let raw = String(phone).replace(/[^0-9]/g, "");

      const knownCodes = [
        "966", "971", "20", "249", "967", "962", "965", "974", "973", "968",
        "964", "212", "213", "216", "218", "970", "961", "963", "222"
      ];

      for (const code of knownCodes) {
        if (raw.startsWith(code)) return raw;
      }

      // KSA local
      if (raw.startsWith("05") && raw.length === 10) {
        return `966${raw.substring(1)}`;
      }

      // Egypt local
      if (raw.startsWith("01") && raw.length === 11) {
        return `20${raw.substring(1)}`;
      }

      // UAE local
      if (raw.startsWith("05") && raw.length === 10) {
        return `971${raw.substring(1)}`;
      }

      return raw;
    }

    // =========================
    // Store Tag (WHATWG URL)
    // =========================
    const u = new URL(req.url, `https://${req.headers.host}`);
    const storeTag = safeText(u.searchParams.get("storeTag") || "EQ");

    // =========================
    // Extract Order Data
    // =========================
    let customerName = "";
    let phone = "";
    let orderId = "";
    let productName = "";
    let quantity = 1;
    let productPrice = 0;
    let shipping = 0;
    let total = 0;
    let address = "";
    let nationalAddress = "";

    if (isShopifyOrder) {
      // Shopify
      const shippingAddress = data.shipping_address || {};
      const billingAddress = data.billing_address || {};
      const firstItem = Array.isArray(data.line_items) ? data.line_items[0] : {};

      customerName = safeText(
        data.customer?.first_name && data.customer?.last_name
          ? `${data.customer.first_name} ${data.customer.last_name}`
          : data.customer?.first_name ||
              shippingAddress.name ||
              billingAddress.name ||
              "Customer"
      );

      phone = normalizePhone(
        shippingAddress.phone ||
          billingAddress.phone ||
          data.phone ||
          data.customer?.phone ||
          ""
      );

      orderId = safeText(data.order_number || data.name || data.id || "");
      productName = safeText(firstItem?.name || "Product");
      quantity = toNumber(firstItem?.quantity || 1);
      productPrice = toNumber(firstItem?.price || 0);
      shipping = toNumber(
        data.shipping_lines?.[0]?.price ||
          data.total_shipping_price_set?.shop_money?.amount ||
          0
      );
      total = toNumber(data.current_total_price || data.total_price || 0);

      address = safeText(
        [
          shippingAddress.address1,
          shippingAddress.address2,
          shippingAddress.city,
          shippingAddress.province,
          shippingAddress.country
        ]
          .filter(Boolean)
          .join(" - ")
      );

      nationalAddress = safeText(
        shippingAddress.company ||
          data.note ||
          "National Address not available"
      );
    } else {
      // EasyOrders / Custom webhook
      const firstItem = Array.isArray(data.cart_items) ? data.cart_items[0] : {};

      customerName = safeText(
        data.customer_name ||
          data.full_name ||
          data.name ||
          "Customer"
      );

      phone = normalizePhone(
        data.phone ||
          data.mobile ||
          data.customer_phone ||
          ""
      );

      orderId = safeText(
        data.short_id ||
          data.order_number ||
          data.id ||
          ""
      );

      productName = safeText(
        firstItem?.name ||
          data.product_name ||
          "Product"
      );

      quantity = toNumber(
        firstItem?.quantity ||
          data.quantity ||
          1
      );

      productPrice = toNumber(
        firstItem?.price ||
          data.subtotal ||
          data.total_price ||
          0
      );

      shipping = toNumber(
        data.shipping ||
          data.shipping_price ||
          0
      );

      total = toNumber(
        data.total ||
          data.total_price ||
          productPrice + shipping
      );

      address = safeText(
        data.address ||
          data.city ||
          data.region ||
          "Address not available"
      );

      nationalAddress = safeText(
        data.national_address ||
          "National Address not available"
      );
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number not found in payload"
      });
    }

    // =========================
    // Template + Language
    // =========================
    const templateName = "confirmation_order";
    const templateLanguage = "en";

    // =========================
    // Format values
    // =========================
    const shippingText = shipping > 0 ? `${shipping} SAR` : "Free";
    const totalText = `${total || productPrice + shipping} SAR`;
    const productPriceText = `${productPrice} SAR`;
    const orderCode = `${orderId} (${storeTag})`;

    // =========================
    // API Config
    // =========================
    const API_BASE_URL = process.env.API_BASE_URL || "https://joud.chat/api/v1";
    const VENDOR_UID = process.env.VENDOR_UID;
    const API_TOKEN = process.env.API_TOKEN;

    if (!VENDOR_UID || !API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "Missing VENDOR_UID or API_TOKEN in environment variables"
      });
    }

    const endpoint = `${API_BASE_URL}/${VENDOR_UID}/contact/send-template-message`;

    // =========================
    // Payload
    // =========================
    const payload = {
      phone_number: phone,
      template_name: templateName,
      template_language: templateLanguage,
      field_1: customerName,
      field_2: orderCode,
      field_3: productName,
      field_4: String(quantity),
      field_5: productPriceText,
      field_6: shippingText,
      field_7: totalText,
      field_8: address,
      field_9: nationalAddress,
      contact: {
        first_name: customerName,
        phone_number: phone,
        country: "auto"
      }
    };

    console.log("🏪 Store:", storeTag, "| isShopifyOrder:", isShopifyOrder);
    console.log("🧩 Template:", templateName, "| Lang:", templateLanguage);
    console.log("🚀 Endpoint:", endpoint);
    console.log("🚀 Payload:", payload);

    // =========================
    // Send Request
    // =========================
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const resultText = await response.text();

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      result = { raw: resultText };
    }

    console.log("📩 API Response:", result);

    return res.status(200).json({
      success: true,
      template_name: templateName,
      template_language: templateLanguage,
      store: storeTag,
      phone,
      result
    });
  } catch (error) {
    console.error("❌ Webhook Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};
