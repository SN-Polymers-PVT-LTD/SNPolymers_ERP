# S.N. Polymers - IDBP Frontend Application

[![React](https://img.shields.io/badge/react-%5E19.0.0-blue.svg)](https://react.dev)
[![Vite](https://img.shields.io/badge/vite-%5E8.0.0-blue.svg)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%5E3.4.4-blueviolet.svg)](https://tailwindcss.com)

This directory contains the user interface for the S.N. Polymers **Integrated Digital Business Platform (IDBP)**. It is built as a single-page React application powered by Vite, Tailwind CSS, and Axios.

---

## Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   └── authApi.js       # Configured Axios client with base URL & cookies credentials
│   ├── components/
│   │   ├── AuthContext.jsx  # Global React Context tracking session details
│   │   └── ProtectedRoute.jsx # Route guards verifying active user sessions
│   ├── pages/
│   │   ├── admin/
│   │   │   ├── AdminPanel.jsx # Audit panel & approval hub for pending registrations
│   │   │   └── AuditLog.jsx   # Searchable and paginated logs dashboard
│   │   ├── Dashboard.jsx    # Portal hub for approved employees
│   │   ├── Home.jsx         # Landing page and gateway route selector
│   │   ├── Login.jsx        # Login entry point with credentials validation
│   │   └── OtpVerify.jsx    # Dedicated OTP authentication checkpoint
│   ├── App.jsx              # Application router registry
│   ├── index.css            # Tailwind theme tokens and base styles
│   └── main.jsx             # React DOM application mount point
├── vite.config.js           # Vite development and builder configurations
└── package.json             # Component scripts and runtime packages
```

---

##  Setup & Launch

### 1. Install Dependencies
Ensure you are in `/frontend` directory:
```bash
npm install
```

### 2. Configure Endpoint Base URL
By default, the UI communicates with the local API server running at `http://localhost:5000/api/v1`. If you need to point to a production API:
- Open [authApi.js](file:///home/zenoguy/Desktop/SNPolymers/frontend/src/api/authApi.js) or configure your environment variables.

### 3. Run Development Server
Start the local server with hot module replacement (HMR):
```bash
npm run dev
```
The interface is now visible at: `http://localhost:5173`

### 4. Build for Production
To bundle and optimize the application assets for deployment:
```bash
npm run build
```
Production assets will compile inside the `/dist` directory.

---

## Routing Strategy & Auth Guards

The application implements a secure routing hierarchy to block unauthorized workspace exploration:

- **Public Routes:** `Home (/)`, `Login (/login)`, `OtpVerify (/verify-otp)`.
- **Protected User Console:** `/dashboard` requires users to have an approved active account.
- **Admin Console:** `/admin` and `/admin/logs` require users to have administrative roles.


