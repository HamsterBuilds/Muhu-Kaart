# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## APK ehitamine (Android)

1. Ekspordi projekt GitHubi ja tee `git pull` oma arvutis, siis `npm install`.
2. `npx cap add android`
3. `npm run build && npx cap sync android`
4. `npx cap run android` (või ava Android Studios ja tee Build > Build APK).

Märkused:
- `capacitor.config.ts` `server.url` laeb live-preview'd. Eemalda see enne poodi minemist, et äpp kasutaks pakendatud faile.
- Asukoha lubadeks lisa `android/app/src/main/AndroidManifest.xml` faili:
  `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`.
