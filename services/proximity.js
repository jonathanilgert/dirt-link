const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Earth radius in km
const EARTH_RADIUS_KM = 6371;

// Haversine distance between two lat/lng points (returns km)
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bounding box: given a center point and radius in km, return min/max lat/lng
// Used as a cheap pre-filter before exact Haversine check
function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.32; // ~111.32 km per degree latitude
  const lngDelta = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

// Check if a user's plan supports proximity alerts
function planSupportsProximity(userType) {
  return userType === 'powerhouse' || userType === 'enterprise';
}

// ── Find all proximity alert subscribers near a given point ──
// Returns array of { setting, user, distanceKm }
function findNearbySubscribers(lat, lng, excludeUserId) {
  // Get all active (non-paused) proximity alert settings
  // joined with the monitored pin's location and user info
  const settings = all(`
    SELECT pas.*, p.latitude AS pin_lat, p.longitude AS pin_lng, p.address AS pin_address, p.title AS pin_title,
           u.id AS uid, u.email, u.phone, u.contact_name, u.company_name, u.user_type,
           u.email_notifications, u.sms_notifications, u.unsubscribe_token, u.proximity_paused
    FROM proximity_alert_settings pas
    JOIN pins p ON pas.pin_id = p.id AND p.is_active = 1
    JOIN users u ON pas.user_id = u.id
    WHERE pas.is_paused = 0
      AND u.proximity_paused = 0
      AND u.user_type IN ('powerhouse', 'enterprise')
      AND pas.user_id != ?
  `, [excludeUserId || '']);

  const matches = [];

  for (const s of settings) {
    // Bounding box pre-filter
    const box = boundingBox(s.pin_lat, s.pin_lng, s.radius_km);
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) {
      continue;
    }

    // Exact Haversine check
    const dist = haversineKm(s.pin_lat, s.pin_lng, lat, lng);
    if (dist <= s.radius_km) {
      matches.push({
        setting: s,
        distanceKm: Math.round(dist * 10) / 10
      });
    }
  }

  return matches;
}

// ── Process a single new pin and notify nearby subscribers ──
// triggerType: 'material_listing' | 'development_permit'
// triggerPin: the new pin object (must have latitude, longitude, address, id)
// isPinTable: 'pins' or 'permit_pins' (determines which FK column to set)
function notifyForNewPin(triggerPin, triggerType, isPinTable) {
  const subscribers = findNearbySubscribers(
    triggerPin.latitude,
    triggerPin.longitude,
    triggerPin.user_id || null // exclude the pin's own creator
  );

  if (subscribers.length === 0) return [];

  const typeLabel = triggerType === 'development_permit' ? 'Development permit' : 'Material listing';
  const triggerAddress = triggerPin.address || 'Unknown location';
  const notifications = [];

  for (const { setting, distanceKm } of subscribers) {
    const notifId = uuidv4();
    const title = `New site near ${setting.pin_title || setting.pin_address}`;
    const body = `${typeLabel} at ${triggerAddress}, approximately ${distanceKm} km from your site.`;
    const link = `${APP_URL}/#map`;

    // Save in-app notification
    if (setting.notify_in_app) {
      run(
        `INSERT INTO proximity_notifications (id, recipient_id, alert_setting_id, trigger_pin_id, trigger_permit_pin_id, trigger_type, distance_km, title, body, link)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notifId, setting.uid, setting.id,
          isPinTable === 'pins' ? triggerPin.id : null,
          isPinTable === 'permit_pins' ? triggerPin.id : null,
          triggerType, distanceKm, title, body, link
        ]
      );
    }

    notifications.push({
      notifId,
      setting,
      distanceKm,
      typeLabel,
      triggerAddress,
      link
    });
  }

  // Send email/SMS for non-batched notifications
  sendProximityNotifications(notifications);

  return notifications;
}

// ── Batch mode: process multiple new pins at once (e.g. bulk API import) ──
// Groups notifications per recipient into a single digest
function notifyForNewPinsBatch(triggerPins, triggerType, isPinTable) {
  // Collect all matches grouped by recipient
  const byRecipient = new Map();

  for (const triggerPin of triggerPins) {
    const subscribers = findNearbySubscribers(
      triggerPin.latitude,
      triggerPin.longitude,
      triggerPin.user_id || null
    );

    for (const { setting, distanceKm } of subscribers) {
      const key = setting.uid;
      if (!byRecipient.has(key)) {
        byRecipient.set(key, { setting, items: [] });
      }
      byRecipient.get(key).items.push({
        triggerPin,
        distanceKm,
        alertSettingId: setting.id,
        pinAddress: setting.pin_address || setting.pin_title
      });
    }
  }

  if (byRecipient.size === 0) return;

  const typeLabel = triggerType === 'development_permit' ? 'Development permit' : 'Material listing';

  for (const [recipientId, { setting, items }] of byRecipient) {
    // Deduplicate: group by the user's monitored pin
    const byMonitoredPin = new Map();
    for (const item of items) {
      const key = item.alertSettingId;
      if (!byMonitoredPin.has(key)) {
        byMonitoredPin.set(key, { pinAddress: item.pinAddress, alerts: [] });
      }
      byMonitoredPin.get(key).alerts.push(item);
    }

    // Create one in-app notification per monitored pin (digest)
    const digestNotifs = [];
    for (const [settingId, { pinAddress, alerts }] of byMonitoredPin) {
      const count = alerts.length;
      const notifId = uuidv4();
      const title = `${count} new site${count > 1 ? 's' : ''} near ${pinAddress}`;
      const body = count === 1
        ? `${typeLabel} at ${alerts[0].triggerPin.address || 'a nearby location'}, approximately ${alerts[0].distanceKm} km from your site.`
        : `${count} new ${typeLabel.toLowerCase()}s appeared near your listing at ${pinAddress} today.`;
      const link = `${APP_URL}/#map`;

      if (setting.notify_in_app) {
        run(
          `INSERT INTO proximity_notifications (id, recipient_id, alert_setting_id, trigger_permit_pin_id, trigger_type, distance_km, title, body, link)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [notifId, recipientId, settingId, alerts[0].triggerPin.id, triggerType, alerts[0].distanceKm, title, body, link]
        );
      }

      digestNotifs.push({
        notifId,
        setting,
        count,
        pinAddress,
        typeLabel,
        link,
        distanceKm: alerts[0].distanceKm,
        triggerAddress: count === 1 ? (alerts[0].triggerPin.address || 'a nearby location') : null
      });
    }

    // Send one digest email/SMS per recipient
    sendProximityDigest(setting, digestNotifs);
  }
}

// ── Send individual proximity email/SMS notifications ──
async function sendProximityNotifications(notifications) {
  // Lazy-load to avoid circular deps
  const { getTransporter, getTwilio, escapeHtml, FROM_EMAIL } = loadNotificationHelpers();

  // Group by recipient for batching
  const byRecipient = new Map();
  for (const n of notifications) {
    const key = n.setting.uid;
    if (!byRecipient.has(key)) byRecipient.set(key, { setting: n.setting, items: [] });
    byRecipient.get(key).items.push(n);
  }

  for (const [, { setting, items }] of byRecipient) {
    // Email
    if (setting.notify_email && setting.email_notifications && setting.email) {
      await sendProximityEmail(setting, items);
    }
    // SMS
    if (setting.notify_sms && setting.sms_notifications && setting.phone) {
      await sendProximitySms(setting, items);
    }
  }
}

// ── Send digest email/SMS for batch imports ──
async function sendProximityDigest(setting, digestNotifs) {
  if (setting.notify_email && setting.email_notifications && setting.email) {
    await sendProximityEmail(setting, digestNotifs);
  }
  if (setting.notify_sms && setting.sms_notifications && setting.phone) {
    await sendProximitySms(setting, digestNotifs);
  }
}

// ── Email for proximity alerts ──
async function sendProximityEmail(setting, items) {
  const nodemailer = require('nodemailer');
  let transporter = null;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  if (!transporter) {
    console.log('[proximity] SMTP not configured — skipping email');
    return;
  }

  const FROM_EMAIL = process.env.FROM_EMAIL || 'messages@dirtlink.ca';

  let unsubToken = setting.unsubscribe_token;
  if (!unsubToken) {
    unsubToken = uuidv4();
    run(`UPDATE users SET unsubscribe_token = ? WHERE id = ?`, [unsubToken, setting.uid]);
  }
  const unsubUrl = `${APP_URL}/unsubscribe/${unsubToken}`;

  const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Build email body
  const alertsHtml = items.map(n => {
    if (n.count && n.count > 1) {
      return `<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:8px 0;">
        <p style="margin:0;font-weight:600;">${n.count} new sites near ${escapeHtml(n.pinAddress)}</p>
        <p style="margin:4px 0 0;color:#6b7280;">${escapeHtml(n.typeLabel)}s within your monitoring radius</p>
      </div>`;
    }
    const addr = n.triggerAddress || 'a nearby location';
    return `<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:8px 0;">
      <p style="margin:0;font-weight:600;">${escapeHtml(n.typeLabel)} at ${escapeHtml(addr)}</p>
      <p style="margin:4px 0 0;color:#6b7280;">~${n.distanceKm} km from your site</p>
    </div>`;
  }).join('');

  const subject = items.length === 1
    ? `New site near your DirtLink listing`
    : `${items.length} new sites near your DirtLink listings`;

  const htmlBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#F59E0B;padding:16px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;color:#fff;">Dirt<strong>Link</strong></h1>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;color:#374151;">Hi ${escapeHtml(setting.contact_name)}, new activity has been detected near your listings:</p>
        ${alertsHtml}
        <div style="margin-top:24px;">
          <a href="${APP_URL}/#map" style="display:inline-block;background:#F59E0B;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View on DirtLink</a>
        </div>
        <p style="margin-top:16px;color:#9ca3af;font-size:13px;">
          You're receiving this because you have proximity alerts enabled on your Powerhouse/Enterprise plan.
          You can adjust your alert radius or pause notifications in your profile settings.
        </p>
      </div>
      <div style="padding:16px 24px;text-align:center;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">
          <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from email notifications</a>
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `DirtLink <${FROM_EMAIL}>`,
      to: setting.email,
      subject,
      html: htmlBody
    });
    console.log(`[proximity] Email sent to ${setting.email}`);
  } catch (err) {
    console.error(`[proximity] Email failed for ${setting.email}:`, err.message);
  }
}

// ── SMS for proximity alerts ──
async function sendProximitySms(setting, items) {
  let twilioClient = null;
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    console.log('[proximity] Twilio not configured — skipping SMS');
    return;
  }

  let body;
  if (items.length === 1 && (!items[0].count || items[0].count === 1)) {
    body = `DirtLink: A new ${items[0].typeLabel.toLowerCase()} appeared near your listing (~${items[0].distanceKm} km). View: ${APP_URL}/#map`;
  } else {
    const total = items.reduce((sum, n) => sum + (n.count || 1), 0);
    body = `DirtLink: ${total} new site${total > 1 ? 's' : ''} detected near your listings. View: ${APP_URL}/#map`;
  }

  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: setting.phone
    });
    console.log(`[proximity] SMS sent to ${setting.phone}`);
  } catch (err) {
    console.error(`[proximity] SMS failed for ${setting.phone}:`, err.message);
  }
}

// Avoid importing from notifications.js to prevent circular deps
function loadNotificationHelpers() {
  return {
    escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  };
}

module.exports = {
  haversineKm,
  boundingBox,
  planSupportsProximity,
  findNearbySubscribers,
  notifyForNewPin,
  notifyForNewPinsBatch
};
