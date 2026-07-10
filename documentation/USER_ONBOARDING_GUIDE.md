# S.N. Polymers Pvt. Ltd. — User Onboarding Guide

Welcome to the **Integrated Digital Business Platform (IDBP)** for **S.N. Polymers Pvt. Ltd.** 

This onboarding guide is designed to help you get up to speed quickly with the portal. Whether you are a Junior Engineer tracking progress on-site, a Zonal Officer managing regional finances, an administrator managing system whitelists, or a Head Office director authorizing approvals, this guide is your quick-start roadmap.

---

## 1. What is IDBP?

The IDBP is a central business hub designed by S.N. Polymers Pvt. Ltd. to streamline and automate our projects. It coordinates:
* **Cost Estimations**: Reviewing and approving civil engineering budgets.
* **Procurement**: Logging payment requisitions against active project limits.
* **Site Monitoring**: Logging daily work progress and tracking physical completion.
* **Financial Controls**: Submitting fund requests and billing running accounts (RA bills).

The platform uses a role-based access model, meaning your user account will only see the options, menus, and data appropriate for your duties.

---

## 2. Setting Up Your Account (One-Time Process)

To log in, your mobile number must first be added to the portal's authorized security whitelist, and your account must be connected to our Telegram notification bot.

### Step 1: Whitelist Authorization
Contact your System Administrator and request whitelist authorization. You will need to provide:
1. Your Full Name (for display on screen headers and audit logs).
2. Your 10-digit Mobile Number.
3. Your Assigned Role (`je`, `zo`, `ho`, or `admin`).

Once whitelisted, you can proceed to establish your Telegram link.

### Step 2: Accessing the Login Portal
1. Open your web browser and navigate to the IDBP URL: [https://sn-polymers.vercel.app/](https://sn-polymers.vercel.app/)
2. Enter your authorized 10-digit mobile number in the login form. The system will automatically format it with the international `+91` prefix.

![Screenshot: Portal Login Page](/docs/images/login_page.png)
*Placeholder: Portal Login Screen showing Mobile Number field and "Verify Whitelist & Send OTP" button.*

3. Click **Verify Whitelist & Send OTP**.

### Step 3: Setting up the Telegram Bot (First Time Only)
If this is your first login, the system will detect that your mobile number is not yet linked to our Telegram Bot and will redirect you to the **Telegram Setup** screen.

![Screenshot: Telegram Setup Screen](/docs/images/telegram_setup_page.png)
*Placeholder: Telegram Setup Screen showing the link to start the Telegram bot.*

To link your account:
1. Click the link provided on the page to open Telegram and start a chat with [@snpolymers_bot](t.me/snpolymers_bot).
2. If prompt, press the **Start** button in Telegram.
3. Telegram will ask you to share your contact. Press the **Share Contact** button in the chat. This allows the bot to securely verify your whitelisted mobile number.
4. Once shared, your Telegram account is connected. Return to the browser window and proceed to login.

---

## 3. Your First Login Walkthrough

Now that your account is whitelisted and linked, logging in takes less than a minute:

1. Enter your mobile number on the login page and click **Verify Whitelist & Send OTP**.
2. Open Telegram and check your messages from the **S.N. Polymers Bot**. You will receive a secure 6-digit One-Time Passcode (OTP) valid for 5 minutes.
3. Enter the 6-digit code on the **OTP Verification** screen in your browser.

![Screenshot: OTP Verification Screen](/docs/images/otp_verify_page.png)
*Placeholder: OTP Code entry page showing numeric input boxes and countdown timer.*

4. Click **Verify Code** to open the main dashboard console.

---

## 4. Platform Navigation Tour

The interface is built to be fast and responsive, whether you are on a laptop at the office or a smartphone on a construction site.

![Screenshot: System Dashboard Console](/docs/images/dashboard_page.png)
*Placeholder: Main Dashboard Interface highlighting the navigation sidebar and key metric cards.*

### The Navigation Sidebar (Desktop)
* **Expand/Collapse**: Click the arrow icon at the top of the sidebar to collapse the menu to a compact icon-only view or expand it for text descriptions.
* **Dynamic Menu Items**: The sidebar adapts to your role. For example, if you are a Junior Engineer, administrative and billing options are hidden, keeping your sidebar clean.
* **Theme Switcher**: Locate the theme button at the bottom of the sidebar. You can toggle between **Light Mode** and **Dark Mode** at any time.
* **Operator Card**: Displays your active role and profile initials. Click the **Sign Out** button at the bottom to end your session.

### Mobile Navigation Header
When viewing from a mobile phone, the sidebar collapses into a compact navigation drawer:
* Use the header bar to quickly access the **Console** dashboard or jump to admin panels (if authorized).
* Click the theme switcher to adjust visibility under direct sunlight on site.

---

## 5. First Steps Checklist by Role

Find your assigned role below and complete your first actions to verify your portal access.

### 👷 Junior Engineer (JE) Checklist
Your primary duties are creating cost estimates and submitting daily progress updates.
* [ ] **Explore the Material Master**: Navigate to the *Material Master* tab. Search for "Cement" or "Steel" to confirm that the material catalog loads correctly.
* [ ] **Initialize an Estimate**: Navigate to *Cost Estimates*, click **New Sheet**, and select an active Work Order. Confirm that the project metadata (State, Zone, District) automatically populates.
* [ ] **Review Site Visit Log**: Go to *Daily Progress* and select an active project directory to confirm you can view past progress reports.

### 📁 Zonal Office (ZO) Checklist
Your role is reviewing regional estimate sheets, initiating fund requests, and logging bills.
* [ ] **Check Cost Estimates Queue**: Navigate to *Cost Estimates* and locate estimates labeled *Under ZO Review*. Open one to inspect how line items display.
* [ ] **View Fund Request Metrics**: Go to the *Fund Requests* dashboard and review the visual distribution charts (Pie Chart of Statuses & Bar Graph of account balances).
* [ ] **Verify Billing Directory**: Open the *RA / Final Bills* screen. Change the tab from *Dashboard* to *Directory* and ensure you can view your zone's projects.

### 🏢 Head Office (HO) Checklist
Your role is final authorization of cost estimates, budget approvals, and disbursing funds.
* [ ] **Access Cost Estimate Queue**: Navigate to *Cost Estimates*. Ensure the toggle is set to **Active Queue** to see estimates awaiting your final review.
* [ ] **Review Fund Requests**: Open the *Fund Requests* console. Click on a request marked *Pending* to open its detailed panel, verifying that the *Approve* and *Hold* buttons are visible.

### ⚙️ System Administrator Checklist
Your role is managing users, whitelists, master catalog data, and auditing compliance.
* [ ] **Check Whitelist**: Go to the *Access Whitelist* panel and search for your own entry to verify your display details.
* [ ] **Inspect Audit Trail Logs**: Navigate to *Audit Trail Logs*. Filter the log view by "Auth" or "Estimate" actions to confirm that user activity records are compiling correctly.
* [ ] **Browse Purchase Options**: Open *Purchase Options* to verify the list of authorized vendors and suppliers.

---

## 6. Glossary of Core Concepts

To help you understand the platform terminology:

* **Work Order (WO)**: A specific contracted infrastructure project with an assigned contract value, client department, and geographical boundaries.
* **Estimate Number**: A unique sheet identifier generated automatically (e.g., `EST-2026-XXXX`) containing the priced material list needed to complete a project.
* **Running Account (RA) Bill**: Progress invoices generated sequentially as phases of site work are completed.
* **Fund Request**: An internal request from Zonal Offices to Head Office for cash transfers to cover regional vendor payments and local expenses.
* **Whitelisting**: The system security rule where only predefined mobile numbers can receive OTP codes and access the portal.
* **Telegram OTP Bot**: The automated assistant bot that delivers login passcodes to your personal Telegram feed, replacing standard SMS notifications.
