# Gerar o app Gasômetro (Android/iOS)

## 1. Pré-requisito: API com HTTPS fixo
O app usa `EXPO_PUBLIC_API_URL`. O fallback em App.tsx (manus.computer) é temporário e vai parar de funcionar.
Hospede a API (Render, Railway, Fly.io, VPS...) com HTTPS e MySQL gerenciado e defina:
    npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://SUA-API.com --environment preview --visibility plaintext
    (repita com --environment production)
Android release bloqueia http:// puro; use https.

## 2. Android (APK para instalar direto — grátis)
    npm install
    npx eas-cli@latest login
    npx eas-cli@latest init
    npx eas-cli@latest build --platform android --profile preview
Ao terminar, abra o link do build no celular e instale o APK.

## 3. iOS
- Só testar: `npx expo start` + app Expo Go no iPhone (grátis).
- Instalável de verdade (TestFlight/App Store): precisa Apple Developer Program (US$ 99/ano):
    npx eas-cli@latest build --platform ios --profile production
    npx eas-cli@latest submit --platform ios

## 4. Play Store
    npx eas-cli@latest build --platform android --profile production   # gera .aab
    npx eas-cli@latest submit --platform android
(1ª publicação exige subir o .aab manualmente no Play Console; conta Google Play: US$ 25 única.)

## Antes de publicar
- Remova as credenciais demo pré-preenchidas na tela de login (App.tsx, Login).
- Troque JWT_SECRET e desligue DEMO_MODE no servidor.
