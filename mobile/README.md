# Gasômetro Mobile — Android/iOS

Este diretório é o **aplicativo nativo para celular**, criado em React Native + Expo. Não é o site/PWA: roda como app Android e iOS, com navegação nativa, componentes `View`, `ScrollView`, `TextInput`, `Modal`, `Alert` e `Linking`.

## Desenvolvimento com Expo Go

```bash
cd mobile
npm install
npx expo start
```

Escaneie o QR Code no **Expo Go** no Android ou iPhone.

A API usa `EXPO_PUBLIC_API_URL` no build, com a URL pública temporária como fallback em `App.tsx`. Para desenvolvimento local com o celular, use o IP da máquina na rede local, por exemplo:

```ts
EXPO_PUBLIC_API_URL=http://192.168.0.20:3000 npx expo start
```

O servidor API precisa estar acessível pelo celular. Para produção, use um domínio HTTPS fixo e configure `EXPO_PUBLIC_API_URL` no perfil de build da EAS.

## Android APK/AAB e iOS IPA

Os builds nativos são feitos com EAS Build, que funciona na nuvem e não exige Android SDK local nem Mac para iniciar o build:

```bash
npm install -g eas-cli
eas login
eas build:configure

# APK instalável para testes Android
eas build --platform android --profile preview

# App Store/TestFlight (o iOS exige conta Apple Developer para assinar)
eas build --platform ios --profile production

# Build das duas plataformas
eas build --platform all --profile production
```

O arquivo `eas.json` já contém os perfis `development`, `preview` (APK Android) e `production` (Android App Bundle + iOS).

## Funcionalidades móveis

- Login com JWT na API existente.
- Início: nível, percentual, status, média de consumo, previsão e alertas.
- Botijões: lista dos medidores e estado `ATIVO`, `INATIVO` ou `OFFLINE`.
- Trocar: registro do peso total e tara do novo botijão.
- Histórico: consumo diário, alertas e trocas.
- WhatsApp: canal, teste, link `wa.me`, fila e histórico de avisos.
- Atualização por gesto de arrastar para baixo.
- Links de WhatsApp abertos pelo aplicativo nativo do celular.

## Backend

O app usa os mesmos endpoints já implementados em `../src`. Para deixar de usar o servidor temporário, altere `API_BASE_URL` para a URL HTTPS permanente da API e gere um novo build.
