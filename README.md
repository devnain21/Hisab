# Nain Photo State — Hisab (हिसाब)

Photo studio / print shop ke liye khata app: udhaar, jama, pending kaam. Hindi UI.

## Stack

- **App**: Expo SDK 57, expo-router, React Query, Firebase Auth (Google)
- **API**: FastAPI + MongoDB (Motor)
- **Auth**: Google Sign-In → Firebase ID token → FastAPI `firebase-admin` verify
- **App ID**: `com.nainphotostate.hisab`

## Local run

### 1. MongoDB

MongoDB Atlas connection string `backend/.env` me `MONGO_URL` pe daalo, ya local Mongo:

```
MONGO_URL=mongodb://localhost:27017
DB_NAME=nain_hisab
```

### 2. Firebase

1. https://console.firebase.google.com pe project banao
2. Authentication → Sign-in method → **Google** enable
3. Android app: package `com.nainphotostate.hisab` (SHA-1 Play Console / `eas credentials` se)
4. iOS app: bundle `com.nainphotostate.hisab`
5. Web app add karke config copy karo
6. Project settings → Service accounts → **Generate new private key**
7. JSON ko `backend/firebase-service-account.json` me save karo (git me mat daalna)

`frontend/.env`:

```
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
```

Web Client ID Firebase Google provider / Cloud Console OAuth 2.0 **Web client** se aata hai. Android/iOS client IDs respective OAuth clients se.

`backend/.env`:

```
MONGO_URL=mongodb://localhost:27017
DB_NAME=nain_hisab
GOOGLE_APPLICATION_CREDENTIALS=firebase-service-account.json
```

Ya poora JSON ek line me: `FIREBASE_CREDENTIALS_JSON={...}`

### 3. Start

```
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000

cd frontend
yarn
yarn start
```

Phone pe test karte hue `EXPO_PUBLIC_BACKEND_URL` me PC ka LAN IP do, `localhost` nahi: `http://192.168.x.x:8000`

Google native login ke liye Expo Go kam pad sakta hai — `npx expo prebuild` + `npx expo run:android` (dev client) behtar hai.

## API

- `POST /api/auth/login` body `{ "id_token": "<firebase id token>" }`
- Bearer token = Firebase ID token
- `GET /api/auth/me`, `POST /api/auth/logout`
- Customers / entries / jobs CRUD pehle jaisa
