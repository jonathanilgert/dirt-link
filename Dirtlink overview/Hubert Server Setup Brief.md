# Hubert — DirtLink Server Setup Brief

**Goal:** Get `https://dirtlink.ca` live and accessible via API key so Hubert can post Calgary development permits.

**Server:** DigitalOcean droplet `159.89.125.8` (same box as e-sign app)
**App location on server:** `/root/dirt-link/`
**Process manager:** PM2 (process name: `dirtlink`)
**App port:** 3001

---

## Steps

### 1. SSH into the droplet

```bash
ssh root@159.89.125.8
```

### 2. Verify DirtLink is running

```bash
pm2 list
```

You should see a process named `dirtlink`. If it's not there:

```bash
cd /root/dirt-link
git pull origin master
npm install --production
pm2 start server.js --name dirtlink
pm2 save
```

If it's already running, just pull latest and restart:

```bash
cd /root/dirt-link
git pull origin master
npm install --production
pm2 restart dirtlink
```

Confirm it responds:

```bash
curl -s http://localhost:3001/ | head -20
```

You should see HTML output (the DirtLink frontend).

### 3. Create the .env on the server

```bash
cd /root/dirt-link
nano .env
```

Paste this — Jonathan will provide the actual secret values:

```
PORT=3001
NODE_ENV=production
SESSION_SECRET=<GENERATE A RANDOM 64-CHAR STRING>
APP_URL=https://dirtlink.ca

STRIPE_SECRET_KEY=<ask Jonathan>
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=<ask Jonathan>
STRIPE_POWERHOUSE_PRICE_ID=<ask Jonathan>
STRIPE_ENTERPRISE_PRICE_ID=<ask Jonathan>

SMTP_HOST=<ask Jonathan>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<ask Jonathan>
SMTP_PASS=<ask Jonathan>
FROM_EMAIL=messages@dirtlink.ca

TWILIO_ACCOUNT_SID=<ask Jonathan>
TWILIO_AUTH_TOKEN=<ask Jonathan>
TWILIO_PHONE_NUMBER=<ask Jonathan>
```

Then restart:

```bash
pm2 restart dirtlink
```

### 4. Generate an API key on the production server

The database on the server is separate from Jonathan's local DB. You need a fresh key:

```bash
cd /root/dirt-link
node -e "
const { getDb, all, run } = require('./database/init');
const { generateApiKey } = require('./middleware/apiKey');
const { v4: uuidv4 } = require('uuid');
getDb().then(() => {
  const users = all('SELECT id, email FROM users');
  console.log('Users:', JSON.stringify(users));
  const id = uuidv4();
  const { key, hash } = generateApiKey();
  // If no users exist yet, use a placeholder created_by
  const createdBy = users.length > 0 ? users[0].id : 'system';
  run('INSERT INTO api_keys (id, name, key_hash, created_by) VALUES (?, ?, ?, ?)',
    [id, 'Hubert Agent', hash, createdBy]);
  console.log('API KEY:', key);
  console.log('Save this key. It cannot be retrieved again.');
});
"
pm2 restart dirtlink
```

Save the `dl_...` key that gets printed. This is your API key for all future requests.

### 5. Point dirtlink.ca DNS to the droplet

In the domain registrar for `dirtlink.ca`, set:

```
A    @       -> 159.89.125.8
A    www     -> 159.89.125.8
```

If there are existing records pointing elsewhere, update them. TTL of 300 (5 min) is fine.

### 6. Set up HTTPS reverse proxy

Check what's already installed:

```bash
caddy version 2>/dev/null && echo "Caddy installed" || echo "No Caddy"
nginx -v 2>/dev/null && echo "Nginx installed" || echo "No Nginx"
```

**If Caddy is installed**, edit the Caddyfile:

```bash
nano /etc/caddy/Caddyfile
```

Add this block (don't remove the existing e-sign block):

```
dirtlink.ca {
    reverse_proxy localhost:3001
}
```

Then reload:

```bash
systemctl reload caddy
```

**If only Nginx is installed**, create a config:

```bash
nano /etc/nginx/sites-available/dirtlink
```

Paste:

```nginx
server {
    listen 80;
    server_name dirtlink.ca www.dirtlink.ca;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20M;
    }
}
```

Enable it and get SSL:

```bash
ln -s /etc/nginx/sites-available/dirtlink /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d dirtlink.ca -d www.dirtlink.ca
```

**If neither is installed**, install Caddy (simplest option):

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

nano /etc/caddy/Caddyfile
```

Paste:

```
dirtlink.ca {
    reverse_proxy localhost:3001
}
```

Then:

```bash
systemctl enable caddy
systemctl start caddy
```

Caddy handles HTTPS certs automatically.

### 7. Open firewall port 443

```bash
ufw status
```

If 443 is not listed:

```bash
ufw allow 443
ufw allow 80
```

### 8. Verify everything works

From the droplet:

```bash
curl -s https://dirtlink.ca/api/external/permit-pins \
  -H "X-API-Key: YOUR_DL_KEY"
```

Should return `[]` (empty array — no permits yet) with HTTP 200.

Test a permit pin post:

```bash
curl -s -w "\nHTTP %{http_code}" \
  -X POST https://dirtlink.ca/api/external/permit-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_DL_KEY" \
  -d '{
    "latitude": 51.0447,
    "longitude": -114.0719,
    "address": "Test Pin - Delete Me",
    "permit_number": "TEST-VERIFY-001",
    "permit_type": "Residential",
    "permit_date": "2026-04-11"
  }'
```

Should return HTTP 201 with the pin JSON. Then clean it up:

```bash
cd /root/dirt-link
node -e "
const { getDb, run } = require('./database/init');
getDb().then(() => run(\"DELETE FROM permit_pins WHERE permit_number = 'TEST-VERIFY-001'\"));
"
pm2 restart dirtlink
```

### 9. Report back

Once step 8 works, report to Jonathan:

- The public URL: `https://dirtlink.ca`
- The API key: `dl_...` (from step 4)
- Confirmation that POST returned 201

Then Hubert can start posting the 10 Calgary development permits.

---

## API Quick Reference for Posting Permits

**Auth:** `X-API-Key: dl_...` header on every request.

**Single permit:**
```
POST https://dirtlink.ca/api/external/permit-pins
Content-Type: application/json
```

**Bulk (all 10 at once):**
```
POST https://dirtlink.ca/api/external/bulk
Content-Type: application/json

{ "permit_pins": [ {...}, {...}, ... ] }
```

**Required fields per permit:**

| Field | Type | Example |
|-------|------|---------|
| latitude | number | 51.0447 |
| longitude | number | -114.0719 |
| address | string | "123 4th Ave SW, Calgary, AB" |
| permit_number | string | "DP2026-0142" (must be unique) |
| permit_type | string | "Residential" / "Commercial" / "Mixed-Use" / "Industrial" |
| permit_date | string | "2026-03-28" |

**Optional fields:**

| Field | Type | Example |
|-------|------|---------|
| project_description | string | "New 12-storey mixed-use tower" |
| estimated_project_size | string | "Small" / "Medium" / "Large" |

**Duplicate handling:** If `permit_number` already exists, the API returns 409 (skip and continue).
