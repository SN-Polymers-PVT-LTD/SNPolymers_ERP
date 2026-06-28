# Infrastructure Cost Report for SN Polymers Pvt. Ltd.

## Executive Summary

This report presents a practical and low-cost cloud infrastructure plan for the internal ERP application proposed for SN Polymers Pvt. Ltd. The application is intended for approximately 30 employees, with only 5 to 10 users expected to use the system at the same time, which means the company does not need expensive enterprise servers or heavy cloud infrastructure.[web:1][web:12][web:14]

The most cost-effective production setup is to host the frontend on Vercel, the backend on Render, and the main database on Supabase. This combination is appropriate because it keeps the application simple to manage, includes core security features such as SSL encryption, and allows the company to scale gradually only when actual business usage increases.[web:1][web:12][web:14]

Under conservative assumptions, the expected recurring infrastructure cost is approximately ₹5,500 to ₹6,500 per month, or about ₹72,000 to ₹78,000 per year before optional communication upgrades. Over a 3-year period, including a reasonable maintenance reserve and operational overhead, the expected total cost of ownership is approximately ₹2.3 lakh to ₹2.9 lakh, which is low for an internal ERP system supporting business operations such as requisitions, billing, reports, dashboards, and file handling.[web:1][web:12][web:14]

For a manufacturing company of this size, this cost level should be considered **low**. It provides enough reliability and room for growth without forcing the company to invest early in dedicated servers, expensive managed enterprise plans, or unnecessary software subscriptions.[web:1][web:12][web:14]

## Assumptions

- The ERP system is for internal use only and is not public-facing.
- The user base is limited to about 30 employees initially.
- Simultaneous usage is expected to remain between 5 and 10 users in normal operations.
- File uploads and report generation will remain moderate in volume during the first 1 to 2 years.
- A planning exchange rate of ₹84 per USD has been used to convert public cloud prices into INR for management budgeting.
- Prices may vary slightly due to foreign exchange movement, taxes, or future provider pricing changes.
- Email, Telegram notifications, and Telegram OTP are assumed to remain free unless usage patterns change or the company decides to adopt paid business messaging.

## Infrastructure Cost Matrix

| Service | Purpose | Current Provider | Free/Paid | Monthly Cost (INR) | Yearly Cost (INR) | Notes |
|---|---|---|---|---:|---:|---|
| Frontend Hosting | Hosts the user interface of the ERP system | Vercel | Paid recommended | 1,680 | 20,160 | Vercel Pro starts at $20 per month; Hobby free tier exists but Pro is safer for business production use.[web:1] |
| Backend Hosting | Runs application logic and APIs | Render | Paid recommended | 588 | 7,056 | Conservative estimate based on Render starter-level production service pricing.[web:14] |
| Database | Stores ERP business data | Supabase PostgreSQL | Paid recommended | 2,100 | 25,200 | Supabase Pro starts at $25 per month and includes backups and production-friendly limits.[web:12] |
| Storage | Stores uploaded files and attachments | Supabase Storage | Included initially | 0 to 250 | 0 to 3,000 | Supabase Pro includes 100 GB file storage before extra charges apply.[web:12] |
| Bandwidth | Handles data transfer between app and users | Vercel / Supabase | Included initially | 0 to 300 | 0 to 3,600 | Internal ERP usage should keep data transfer low in the early phase.[web:1][web:12] |
| Email | Sends OTPs and system emails | Nodemailer SMTP | Free currently | 0 | 0 | No paid mail service is needed at current low volume. |
| Notifications | Sends internal alerts | Telegram Bot | Free | 0 | 0 | Good fit while only staff use the application. |
| OTP | Sends login verification codes | Telegram OTP | Free | 0 | 0 | Lowest-cost method for an internal employee system. |
| Domain | Public web address for the application | Registrar | Paid | 75 | 900 | Conservative budget assumption for one domain renewal per year. |
| SSL | Secures data between browser and server | Included with hosting | Free included | 0 | 0 | Usually bundled with modern cloud hosting providers.[web:1][web:14] |
| Backups | Data recovery and restore support | Supabase Pro + manual export | Included + small reserve | 0 to 300 | 0 to 3,600 | Supabase Pro includes daily backups with 7-day retention.[web:12] |
| Monitoring | Tracks uptime and issues | Provider tools / basic alerts | Mostly free | 0 to 250 | 0 to 3,000 | Free monitoring is sufficient at this scale. |
| Logging | Reviews application errors and events | Provider logs | Mostly included | 0 to 250 | 0 to 3,000 | Extra cost only if advanced logging is added later. |
| Maintenance Buffer | Protects against small overruns | Internal reserve | Paid reserve | 1,000 | 12,000 | Recommended for budgeting stability. |

### Estimated Recurring Cost

- **Base monthly operating cost:** approximately ₹5,441 to ₹6,291.[web:1][web:12][web:14]
- **Base yearly operating cost:** approximately ₹65,316 to ₹75,516.[web:1][web:12][web:14]
- **Optional WhatsApp Business migration:** add approximately ₹6,000 to ₹7,000 per year based on expected low-volume internal use.

## Deployment Cost

The following costs are one-time production deployment costs. These are not monthly cloud bills; they represent the effort needed to launch the system in a controlled business environment.

| One-Time Item | Description | Estimated Cost (INR) | One-Time? | Notes |
|---|---|---:|---|---|
| Domain purchase | Initial domain registration | 900 | Yes | First-year cost assumption. |
| Initial deployment | Publishing the application to live production | 8,000 to 15,000 | Yes | Includes production release process. |
| Configuration | Setting up environment variables, SMTP, Telegram, database links, access control | 5,000 to 10,000 | Yes | Business-ready setup effort. |
| SSL setup | Secure certificate installation | 0 | Yes | Usually included by the platform.[web:1][web:14] |
| DNS setup | Connecting the domain to hosting services | 1,000 to 2,500 | Yes | Small setup and verification effort. |
| Testing | Final production validation | 5,000 to 10,000 | Yes | Includes business workflow verification. |
| Go-live support | Launch support during the first few days | 3,000 to 8,000 | Yes | Covers immediate issue handling. |

### Estimated One-Time Deployment Budget

A practical one-time deployment budget is **₹22,900 to ₹46,400**.

## Annual Maintenance Cost

Annual maintenance includes cloud renewals, platform usage, small growth in storage, and a realistic budget for bug fixing and minor changes after go-live.

### Mandatory Annual Costs

| Mandatory Item | Estimated Yearly Cost (INR) | Notes |
|---|---:|---|
| Frontend hosting | 20,160 | Vercel Pro.[web:1] |
| Backend hosting | 7,056 | Render starter production estimate.[web:14] |
| Database | 25,200 | Supabase Pro.[web:12] |
| Domain renewal | 900 | Annual renewal assumption. |
| Storage and bandwidth reserve | 3,000 | Conservative usage cushion. |
| Backup/admin reserve | 3,600 | For backup handling discipline and admin checks.[web:12] |
| Maintenance buffer | 12,000 | Contingency reserve. |

**Estimated mandatory annual operating cost:** **₹71,916**.[web:1][web:12][web:14]

### Optional Annual Costs

| Optional Item | Estimated Yearly Cost (INR) | Notes |
|---|---:|---|
| Monitoring upgrades | 3,000 | Only if advanced alerting is required. |
| Extended logging | 3,000 | Only if management wants deeper traceability. |
| Bug-fix support | 15,000 to 40,000 | Depends on support arrangement. |
| Minor enhancements | 20,000 to 60,000 | Reports, fields, workflow changes. |
| Cloud upgrades | 10,000 to 30,000 | Needed only if growth exceeds current assumptions. |
| WhatsApp Business | 6,000 to 7,000 | Optional future communication channel. |

A realistic annual budget for operations plus limited support is **₹0.75 lakh to ₹1.4 lakh**.

## Scaling Cost Matrix

The first services likely to need upgrades are the backend server, the database, and file storage, because these are the components most directly affected by more active users, more uploaded documents, and more system transactions.[web:12][web:14]

| User Count | Estimated Monthly Infrastructure Cost (INR) | Likely Upgrade Trigger |
|---|---:|---|
| 30 Users | 5,500 to 6,500 | Current recommended setup is sufficient. |
| 50 Users | 6,500 to 8,000 | Slight backend and storage headroom may be needed. |
| 100 Users | 9,000 to 12,000 | Backend and database plan likely upgraded first. |
| 250 Users | 16,000 to 24,000 | Stronger backend, larger database, better monitoring. |
| 500 Users | 28,000 to 45,000 | More substantial cloud scaling and support tooling. |

This shows that the solution is scalable in stages. The company can avoid paying for large infrastructure upfront and increase spend only when the business actually grows.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Provider outage | Low to Medium | Medium | Keep periodic data exports and use reliable managed cloud services. |
| Database growth | Medium | Medium | Review storage quarterly and upgrade only when usage reaches limits.[web:12] |
| Storage increase | Medium | Low to Medium | Archive old files and monitor uploads regularly.[web:12] |
| Higher API usage | Low | Low to Medium | Upgrade backend only when real response delays appear.[web:14] |
| WhatsApp migration | Medium | Low | Delay migration until there is a clear business need. |
| Unexpected traffic | Low | Low | Internal-only deployment keeps this risk limited. |
| Cost creep from optional tools | Medium | Medium | Approve paid add-ons only after management review. |
| Dependence on free tools | Medium | Medium | Use free tools only where the business can tolerate minor service dependency. |

## Cost Optimization Suggestions

- Continue using **Telegram** for OTP and notifications while the system remains internal. This can avoid approximately **₹6,000 to ₹7,000 per year** compared with an early move to WhatsApp Business.
- Stay on **Supabase Pro** unless actual storage or performance needs increase. Pro already includes 8 GB database storage, 100 GB storage, and daily backups for 7 days.[web:12]
- Use **Render starter-level hosting** until usage clearly grows. Upgrading too early adds recurring cost without immediate business value.[web:14]
- Keep **email on a free SMTP setup** while message volume remains low.
- Avoid dedicated servers now. They would increase fixed monthly cost and create additional system administration burden without clear benefit for only 30 internal users.
- Upgrade infrastructure only when reports, files, or user concurrency show measurable growth.

## Recommended Production Plan

The cheapest reliable production plan for SN Polymers’ internal ERP is shown below.

| Component | Recommended Option | Why it is recommended |
|---|---|---|
| Frontend Hosting | Vercel Pro | Reliable, easy to manage, and commercially appropriate for production.[web:1] |
| Backend Hosting | Render Starter | Lowest practical paid hosting for a small always-on internal application.[web:14] |
| Database | Supabase Pro | Good value managed PostgreSQL with backups and included storage.[web:12] |
| Storage | Supabase Storage | Already part of the same managed platform and suitable for file uploads.[web:12] |
| Email | Nodemailer SMTP | Free and sufficient at current scale. |
| Notifications | Telegram Bot | Free and suitable for internal staff alerts. |
| Backups | Supabase daily backups + monthly manual export | Good balance of cost and recovery readiness.[web:12] |
| Monitoring | Basic provider monitoring + simple uptime alerts | Enough for a 30-user internal system. |

This architecture is the best value-for-money option because it keeps recurring costs low, reduces administration effort, and still leaves room to upgrade gradually when business usage increases.

## Five-Year Cost Projection

The following projection assumes moderate company growth and gradual increase in support effort.

| Year | Infrastructure Cost (INR) | Maintenance Cost (INR) | Optional Upgrade Cost (INR) | Total Cost (INR) |
|---|---:|---:|---:|---:|
| Year 1 | 72,000 | 20,000 | 0 | 92,000 |
| Year 2 | 78,000 | 25,000 | 0 | 103,000 |
| Year 3 | 90,000 | 30,000 | 7,000 | 127,000 |
| Year 4 | 108,000 | 36,000 | 12,000 | 156,000 |
| Year 5 | 132,000 | 45,000 | 18,000 | 195,000 |

This gives an indicative five-year spend of approximately **₹6.73 lakh**, which remains reasonable for a system supporting core internal workflows.

## Final Recommendation

The proposed infrastructure is sufficient for the current internal ERP requirement at SN Polymers Pvt. Ltd. It is scalable enough for moderate growth, secure enough for normal internal business use when deployed correctly, and cost-effective for a company of this size.[web:1][web:12][web:14]

The company should **not** invest in dedicated servers at this stage. The expected annual operating cost is approximately **₹0.7 lakh to ₹0.9 lakh** in the current phase, and the cheapest practical deployment strategy is to use **Vercel Pro + Render Starter + Supabase Pro + free internal communication channels** until real usage patterns justify any upgrade.[web:1][web:12][web:14]

This approach minimizes recurring cost while maintaining acceptable reliability, security, and flexibility for future expansion.
