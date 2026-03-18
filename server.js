import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  throw new Error("8514059253:AAF5-LXRJnPZts9cDRQV7sB7qA49lyzVpRk");
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function validateTelegramInitData(initData, botToken) {
  if (!initData) return { ok: false, error: "initData manquant" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "hash manquant" };

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    return { ok: false, error: "signature Telegram invalide" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || now - authDate > 3600) {
    return { ok: false, error: "session Telegram expirée" };
  }

  let user = null;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {}
  }

  return { ok: true, user };
}

function formatOrderMessage(order) {
  const user = order.user || {};
  const itemsText = order.items.map((item, idx) => {
    const sizePart = item.size ? ` • Taille: ${escapeHtml(item.size)}` : "";
    return [
      `${idx + 1}. <b>${escapeHtml(item.brand)}</b> — ${escapeHtml(item.name)}`,
      `Qté: ${item.qty}${sizePart}`,
      `Prix: ${Number(item.price).toLocaleString("fr-FR")} €`
    ].join("\n");
  }).join("\n\n");

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const username = user.username ? `@${user.username}` : "aucun";

  return [
    `🛍 <b>Nouvelle demande boutique</b>`,
    ``,
    `<b>Client:</b> ${escapeHtml(fullName || "Inconnu")}`,
    `<b>User ID:</b> ${user.id || "Inconnu"}`,
    `<b>Username:</b> ${escapeHtml(username)}`,
    ``,
    `<b>Articles:</b>`,
    itemsText,
    ``,
    `<b>Total:</b> ${Number(order.totalPrice).toLocaleString("fr-FR")} €`
  ].join("\n");
}

async function telegramApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Erreur Telegram API sur ${method}`);
  }

  return data;
}

app.post("/api/checkout", async (req, res) => {
  try {
    const { initData, items, totalPrice } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Panier vide" });
    }

    const validation = validateTelegramInitData(initData, BOT_TOKEN);
    if (!validation.ok) {
      return res.status(401).json({ ok: false, error: validation.error });
    }

    const cleanItems = items.map((item) => ({
      id: Number(item.id),
      name: String(item.name || ""),
      brand: String(item.brand || ""),
      size: item.size ? String(item.size) : null,
      qty: Math.max(1, Number(item.qty) || 1),
      price: Number(item.price) || 0
    }));

    const computedTotal = cleanItems.reduce((sum, item) => {
      return sum + item.price * item.qty;
    }, 0);

    if (Number(totalPrice) !== computedTotal) {
      return res.status(400).json({ ok: false, error: "Total invalide" });
    }

    const order = {
      user: validation.user,
      items: cleanItems,
      totalPrice: computedTotal
    };

    const adminMessage = formatOrderMessage(order);

    await telegramApi("sendMessage", {
      chat_id: ADMIN_CHAT_ID,
      text: adminMessage,
      parse_mode: "HTML"
    });

    if (validation.user?.id) {
      await telegramApi("sendMessage", {
        chat_id: validation.user.id,
        text: `Votre demande a bien été reçue.\nMontant total : ${computedTotal.toLocaleString("fr-FR")} €`
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("checkout error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Erreur interne" });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
