# Part 6: API Specifications Reference
## S.N. Polymers IDBP REST API Endpoints Registry

This document lists endpoint contracts, payload requirements, Zod schemas, status codes, and JSON examples.

---

## 1. Authentication Endpoints

### 1.1 Request Login OTP
* **URL**: `/api/v1/auth/request-otp`
* **Method**: `POST`
* **Authentication**: None
* **Request Body Schema**:
  ```json
  {
    "mobileNumber": "+91XXXXXXXXXX" (Mandatory, E.164 String)
  }
  ```
* **Business Logic**: Validates that the number exists on the whitelist and is active. Hashes and stores the OTP code, then sends it via Telegram.
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "OTP sent successfully."
  }
  ```
* **Error Response (403)**:
  ```json
  {
    "success": false,
    "message": "Access denied. Mobile number is not whitelisted."
  }
  ```

### 1.2 Verify OTP Code
* **URL**: `/api/v1/auth/verify-otp`
* **Method**: `POST`
* **Authentication**: None
* **Request Body Schema**:
  ```json
  {
    "mobileNumber": "+91XXXXXXXXXX" (Mandatory, E.164 String),
    "otp": "XXXXXX" (Mandatory, 6-digit Numeric String)
  }
  ```
* **Success Response (200)**:
  Set-Cookie: `token=eyJhbGciOi...; HttpOnly; Secure; SameSite=None`
  ```json
  {
    "success": true,
    "user": {
      "id": "8756ad9a-4c22-4411-a889-1065ea4e41ba",
      "mobile_number": "+919876543210",
      "display_name": "Supervisor One",
      "role": "zo",
      "permissions": {}
    }
  }
  ```
* **Error Response (400)**:
  ```json
  {
    "success": false,
    "message": "Invalid OTP code. 2 attempts remaining."
  }
  ```

---

## 2. Fund Reports Endpoints

### 2.1 Create Fund Report
* **URL**: `/api/v1/auth/reports`
* **Method**: `POST`
* **Authentication**: Valid session JWT.
* **Authorization**: Staff or Admin roles.
* **Request Body Schema**:
  ```json
  {
    "work_order_no": "WB_APD_101" (Mandatory, String),
    "amount": 15000.50 (Mandatory, positive Float),
    "remarks": "Site foundation concrete procurement" (Optional, String)
  }
  ```
* **Business Logic**: Enforces project status checks on `projects_master`. Rejects insertion if project is `Closed`.
* **Success Response (201)**:
  ```json
  {
    "success": true,
    "report": {
      "fund_report_id": "9812480b-449e-4aab-b921-2a12389104fa",
      "work_order_no": "WB_APD_101",
      "amount": 15000.50,
      "remarks": "Site foundation concrete procurement",
      "created_by": "+919876543210",
      "created_at": "2026-06-27T03:32:00.000Z"
    },
    "message": "Fund report created successfully."
  }
  ```
* **Error Response (403)**:
  ```json
  {
    "success": false,
    "message": "Cannot create reports for projects with \"Closed\" status. All linked reports are immutable."
  }
  ```
