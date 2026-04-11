# DirtLink External API Documentation

Base URL: `https://your-domain.com/api`

## Authentication

All external API endpoints require an API key passed in the `X-API-Key` header.

```
X-API-Key: dl_your_api_key_here
```

### Managing API Keys

API keys are managed through the web interface (requires login) or via the key management endpoints.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/keys` | Generate a new API key |
| GET | `/api/keys` | List all your API keys |
| DELETE | `/api/keys/:id` | Revoke an API key |
| POST | `/api/keys/:id/rotate` | Rotate a key (revokes old, creates new) |

#### Generate a Key

```bash
# Requires session auth (logged-in user)
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name": "Hubert Agent"}'
```

Response:
```json
{
  "id": "uuid",
  "name": "Hubert Agent",
  "key": "dl_abc123...",
  "message": "Store this key securely — it will not be shown again."
}
```

> **Important:** The plaintext key is only returned once at creation time. Store it securely.

---

## Rate Limiting

All external API endpoints are rate-limited to **60 requests per minute** per API key.

Response headers:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `Retry-After`: Seconds until the limit resets (only on 429 responses)

---

## Endpoints

### 1. Create Permit Pin

Creates an opaque (unclaimed) development permit pin on the map.

```
POST /api/external/permit-pins
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `latitude` | number | -90 to 90 |
| `longitude` | number | -180 to 180 |
| `address` | string | Site street address |
| `permit_number` | string | Unique permit identifier |
| `permit_type` | string | Type of permit (e.g., "residential", "commercial") |
| `permit_date` | string | Date the permit was issued |

**Optional fields:**

| Field | Type | Description |
|-------|------|-------------|
| `project_description` | string | Description of the project |
| `estimated_project_size` | string | Estimated size/scope |

**Example:**
```bash
curl -X POST http://localhost:3000/api/external/permit-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dl_your_key_here" \
  -d '{
    "latitude": 51.0447,
    "longitude": -114.0719,
    "address": "123 4th Ave SW, Calgary, AB",
    "permit_number": "DP2024-0001",
    "permit_type": "commercial",
    "permit_date": "2024-03-15",
    "project_description": "New 12-storey mixed-use tower",
    "estimated_project_size": "Large"
  }'
```

**Response (201):**
```json
{
  "id": "uuid",
  "latitude": 51.0447,
  "longitude": -114.0719,
  "address": "123 4th Ave SW, Calgary, AB",
  "permit_number": "DP2024-0001",
  "permit_type": "commercial",
  "permit_date": "2024-03-15",
  "project_description": "New 12-storey mixed-use tower",
  "estimated_project_size": "Large",
  "status": "unclaimed",
  "is_active": 1,
  "created_at": "2024-03-15 12:00:00"
}
```

**Error (409 — duplicate permit):**
```json
{
  "error": "A pin with this permit number already exists",
  "existing_id": "uuid"
}
```

---

### 2. Create Permanent Site Pin

Creates a permanent, non-claimable pin (e.g., landfill, transfer station).

```
POST /api/external/permanent-pins
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `latitude` | number | -90 to 90 |
| `longitude` | number | -180 to 180 |
| `site_name` | string | Name of the site |
| `site_type` | string | Type: "landfill", "transfer_station", etc. |
| `address` | string | Site address |

**Optional fields:**

| Field | Type | Description |
|-------|------|-------------|
| `contact_phone` | string | Phone number |
| `contact_email` | string | Email address |
| `hours_of_operation` | string | Operating hours |
| `accepted_materials` | string | Materials accepted |
| `rates_fees` | string | Fee schedule |
| `website_url` | string | Website URL |
| `notes` | string | Additional notes |

**Example:**
```bash
curl -X POST http://localhost:3000/api/external/permanent-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dl_your_key_here" \
  -d '{
    "latitude": 51.0012,
    "longitude": -114.0453,
    "site_name": "Spyhill Landfill",
    "site_type": "landfill",
    "address": "11808 85 St NW, Calgary, AB",
    "contact_phone": "403-268-2489",
    "hours_of_operation": "Mon-Sat 7:30AM-5:00PM",
    "accepted_materials": "Clean fill, concrete, asphalt, wood waste",
    "rates_fees": "$25/tonne general waste",
    "website_url": "https://www.calgary.ca/waste",
    "notes": "No hazardous materials"
  }'
```

---

### 3. Bulk Create

Create multiple permit and/or permanent pins in a single request. Maximum **500** of each type per request.

```
POST /api/external/bulk
```

**Body:**
```json
{
  "permit_pins": [
    { "latitude": 51.04, "longitude": -114.07, "address": "...", "permit_number": "DP-001", "permit_type": "commercial", "permit_date": "2024-01-01" },
    { "latitude": 51.05, "longitude": -114.08, "address": "...", "permit_number": "DP-002", "permit_type": "residential", "permit_date": "2024-01-02" }
  ],
  "permanent_pins": [
    { "latitude": 51.00, "longitude": -114.04, "site_name": "East Landfill", "site_type": "landfill", "address": "..." }
  ]
}
```

**Response (201 — all succeeded, or 207 — partial success):**
```json
{
  "summary": {
    "permit_pins_created": 2,
    "permanent_pins_created": 1,
    "errors": 0
  },
  "permit_pins": [
    { "id": "uuid-1", "permit_number": "DP-001" },
    { "id": "uuid-2", "permit_number": "DP-002" }
  ],
  "permanent_pins": [
    { "id": "uuid-3", "site_name": "East Landfill" }
  ],
  "errors": []
}
```

---

### 4. List Permit Pins (via API)

```
GET /api/external/permit-pins?status=unclaimed&limit=50&offset=0
```

### 5. List Permanent Pins (via API)

```
GET /api/external/permanent-pins?site_type=landfill&limit=50&offset=0
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "details": ["field-level error 1", "field-level error 2"]
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Missing API key |
| 403 | Invalid or revoked API key |
| 409 | Conflict (duplicate permit number) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Audit Logging

All API calls are logged with: API key ID, method, path, status code, response time, request body, and IP address. Logs are stored in the `audit_log` database table.

---

## Pin Display on Map

- **Permit pins** appear as semi-transparent grey triangles with a "?" marker — indicating unclaimed development permit sites
- **Permanent pins** appear as colored squares: purple (landfill), teal (transfer station), or brown (other)
- **Standard pins** remain as colored triangles (up = HAVE, down = NEED) with the existing category color coding
