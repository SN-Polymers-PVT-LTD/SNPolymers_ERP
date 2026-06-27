# Part 8: Business Workflows Diagrams
## S.N. Polymers IDBP Operational Flowcharts

This document maps out system actors, sequence flows, database transactions, validation checkpoints, and status transitions.

---

## 1. Authentication Sequence

This workflow describes the OTP authentication sequence, including whitelist checks, Telegram linkage validation, and token issuance:

```mermaid
sequenceDiagram
    autonumber
    actor User as Whitelisted Operator
    participant FE as React Frontend
    participant BE as Express API Gateway
    participant DB as PostgreSQL Database
    participant TG as Telegram Bot API

    User->>FE: Input Mobile Number
    FE->>BE: POST /request-otp { mobileNumber }
    BE->>DB: SELECT * FROM authorised_users WHERE mobile_number = ?
    alt Not Whitelisted or Deactivated
        DB-->>BE: No active user found
        BE-->>FE: 403 Forbidden
        FE-->>User: Display Access Denied error
    else Whitelisted and Active
        DB-->>BE: User details returned
        alt telegram_chat_id is null
            BE-->>FE: Redirect to /link-telegram
            FE->>User: Display Telegram Linkage Instructions
            User->>TG: Message @snpolymers_bot
            TG-->>User: "Hi! Chat ID: 887162831"
            User->>FE: Input Chat ID
            FE->>BE: POST /link-telegram { mobileNumber, chatId }
            BE->>DB: UPDATE authorised_users SET telegram_chat_id
            DB-->>BE: Confirmation
        end
        BE->>BE: Generate 6-digit OTP
        BE->>BE: bcrypt.hash(rawOtp)
        BE->>DB: INSERT INTO otp_requests (hash, expires_at)
        BE->>TG: sendOtp via sendMessage
        TG-->>User: Deliver Login Code via Bot Chat
        BE-->>FE: 200 Success
        FE->>User: Render OTP Input view
        User->>FE: Input 6-digit OTP
        FE->>BE: POST /verify-otp { mobileNumber, otp }
        BE->>DB: SELECT latest otp_request WHERE mobile_number = ?
        alt Retry limit (attempts >= 3) or Expired
            BE-->>FE: 400 Bad Request
            FE-->>User: Display lockout warning
        else Hash Match Valid
            BE->>DB: UPDATE otp_requests SET is_used = true
            BE->>DB: INSERT INTO sessions (jwt_jti, ip, user_agent)
            BE-->>FE: 200 Success + Cookie (HttpOnly Token)
            FE->>User: Redirect to Console Dashboard
        end
    end
```

---

## 2. Daily Site Progress Submission

This workflow outlines the sequence JEs execute to submit cumulative progress metrics:

```mermaid
sequenceDiagram
    autonumber
    actor JE as Junior Engineer
    participant FE as React Frontend
    participant BE as Express API Gateway
    participant DB as PostgreSQL Database
    participant Storage as Supabase Storage

    JE->>FE: Select site photo & enter progress %
    FE->>FE: Client-side file checks (<=10MB, jpeg/png)
    FE->>BE: POST /daily-progress/upload/photo (Form Data)
    BE->>BE: Verify image buffer MIME magic bytes
    BE->>Storage: Upload to bucket "daily-progress-photos"
    Storage-->>BE: Return storage path
    BE-->>FE: Return UUID photo path
    FE->>BE: POST /daily-progress { work_order_no, physical_work_progress, daily_site_photo_url }
    BE->>DB: SELECT status FROM projects_master WHERE work_order_no = ?
    alt Project status is Closed
        DB-->>BE: Status "Closed"
        BE-->>FE: 403 Forbidden (Project is Immutable)
        FE-->>JE: Display Project Locked warning
    else Project status is Running
        DB-->>BE: Status "Running"
        BE->>DB: INSERT INTO daily_progress_reports
        DB-->>BE: Insert confirmation
        BE-->>FE: 201 Created
        FE->>JE: Refresh ledger list
    end
```
