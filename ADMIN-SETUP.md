# Existing-server admin deletion (no Firebase Functions)

Configure only on the trusted web server:

- `FIREBASE_PROJECT_ID=muhu-kaart`
- `FIREBASE_SERVICE_ACCOUNT_JSON`: a service-account JSON credential with Firestore access, supplied as a private server secret; alternatively `GOOGLE_APPLICATION_CREDENTIALS` pointing to a private credential file.

Never prefix credentials with `VITE_`, commit them, or bundle them into the APK.

Set GitHub Actions variable `APP_SERVER_URL` to this app's public HTTPS origin for APK builds. Web builds use the same-origin endpoint.

The endpoint verifies the Firebase token (including revocation), exact verified email and Google sign-in provider. Only `hamsterbuildsee@gmail.com` can invoke deletion, with typed confirmation. It deletes only `tracks` recursively and recreates an empty placeholder. It does not recover data or erase local copies. Pending device uploads can repopulate tracks.

No live deletion should be used as a deployment test. Existing-server hosting and Firestore quotas still apply; this does not enable a paid Firebase plan.
