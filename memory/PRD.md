# Nain Photo State — Hisab (हिसाब)

## Overview
A React Native (Expo) mobile app for photo state / print shop owners to manage customer credit (उधार), payments (जमा), and pending jobs (काम). Everything in Hindi (Devanagari). Data is saved online per-user via Google Sign-In (Emergent-managed).

## Tech Stack
- **Frontend**: Expo SDK 57, expo-router, React Query, expo-web-browser, expo-linking, expo-secure-store
- **Backend**: FastAPI + Motor (MongoDB) + httpx (for Emergent auth)
- **Auth**: Emergent Managed Google Auth (session token, 7 day expiry)
- **Data store**: MongoDB — collections: users, user_sessions, customers, entries, jobs (all data user-scoped)

## Features
1. **Login** — Google Sign-In (Emergent). Session token persisted (`expo-secure-store` mobile / `localStorage` web).
2. **Home (घर)** — Dashboard: total due, today's udhaar/jama, pending jobs; top-5 debtor list; upcoming jobs; recent entries; quick add actions.
3. **Customers (ग्राहक)** — Search + filter (बकाया / सभी / क्लियर) list, FAB to add customer.
4. **Customer detail** — Balance hero, quick actions (उधार / जमा / काम), pending jobs, timeline with running balance, edit/delete.
5. **Work (काम)** — Job list with filter (बाकी / पूरा / सभी), start / complete / delete actions. Completing with estimate auto-adds an udhaar entry.
6. **Profile (खाता)** — Google user info, online sync indicator, stats, sign out.

## Key Design
- Cream paper (#FDFBF7) surface, brick red (#C62828) for udhaar, forest green (#2E7D32) for jama, teal (#00796B) brand.
- Devanagari system font (Noto family renders on iOS/Android).
- Bottom sheets for forms.

## Data Model (MongoDB)
- `users`: `{ user_id, email, name, picture, createdAt }`
- `user_sessions`: `{ session_token, user_id, created_at, expires_at }` (TTL on expires_at)
- `customers`: `{ id, user_id, name, phone, address, notes, createdAt }`
- `entries`: `{ id, user_id, customerId, type: "work"|"payment", date, description, amount, notes, createdAt }`
- `jobs`: `{ id, user_id, customerId, title, dueDate, status, estimatedAmount, notes, createdAt }`

## API
All routes prefixed with `/api`. Public: `POST /auth/session`. Authenticated (Bearer): `GET /auth/me`, `POST /auth/logout`, CRUD for `customers`, `entries`, `jobs`.
