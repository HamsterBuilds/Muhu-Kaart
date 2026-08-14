# Muhu kaart

Muhu saare kaardirakendus GPS-radade, gruppide ja jagatud punktidega.

## Arendus

```sh
npm install
npm run dev
```

## Android APK

APK ehitatakse GitHub Actionsiga ja lisatakse GitHub Release’i. Kohalikuks Androidi buildiks:

```sh
npm run build:capacitor
npx cap add android
npx cap sync android
```
