# Gerar e baixar o APK do motoboy

O workflow `Android APK` (GitHub Actions) compila um APK de release assinado e publica o arquivo
como artefato da execução. O app instalado abre o sistema publicado na Vercel
(`https://minas-mais-entregas.vercel.app`), então as telas se atualizam sem novo APK; só é preciso
gerar outro APK quando mudar algo nativo (ícone, permissões, plugins).

## Chave de assinatura (uma vez)

A chave fica em `.local/android-signing/` neste computador (fora do Git):

- `minas-mais-release.p12` — a chave (PKCS#12).
- `LEIA-ME.txt` — alias e senha.
- `ANDROID_KEYSTORE_BASE64.txt` — a chave em texto, para colar no GitHub.

**Guarde uma cópia segura dessa pasta.** Todos os APKs de atualização (e a Play Store) precisam da
mesma chave.

## Cadastrar os secrets no GitHub (uma vez)

Em **github.com/minasmaissuporte-afk/minasmais_entregas → Settings → Secrets and variables →
Actions → New repository secret**, crie:

| Nome | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | conteúdo de `ANDROID_KEYSTORE_BASE64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | a senha do `LEIA-ME.txt` |
| `ANDROID_KEY_PASSWORD` | a mesma senha do `LEIA-ME.txt` |
| `ANDROID_KEY_ALIAS` | `minas-mais-entregas` |

## Gerar o APK

1. **Actions → Android APK → Run workflow** (ou um merge na `main` que mexa no app).
2. Quando ficar verde, baixe o artefato `minas-mais-entregas-android-N` em **Artifacts** (é um .zip
   com o `app-release.apk`).
3. No celular Android: abra o APK, permita "instalar apps desconhecidos" para o navegador/arquivos
   e instale.

## Notificações

O `google-services.json` (Firebase) fica em `artifacts/minas-mais-entregas/android/app/` e precisa
continuar no repositório. O servidor (Vercel) usa `FIREBASE_SERVICE_ACCOUNT_JSON` para enviar os
avisos ao app instalado.

## iPhone

Sem conta Apple Developer não há TestFlight. Enquanto isso, no iPhone use o app pelo Safari:
abrir `https://minas-mais-entregas.vercel.app/motoboy-pwa` → Compartilhar → **Adicionar à Tela de
Início**. Avisos (push) funcionam no iOS 16.4 ou mais novo com o app aberto pela tela de início.
