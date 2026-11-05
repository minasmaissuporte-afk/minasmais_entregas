# Gerar e baixar o APK do motoboy

O workflow `Android APK` compila um APK de release assinado e publica o arquivo como um artefato da execução no GitHub Actions.

## Antes de executar

1. No painel Git do Replit, conecte este projeto ao repositório GitHub correto e envie as alterações para `main` ou `master`.
2. Em **Settings → Secrets and variables → Actions**, crie os secrets abaixo:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
   Os valores da chave de assinatura criada para este projeto estão em `.local/android-signing/github-actions-secrets.txt`. Esse arquivo fica fora do Git; copie cada valor diretamente para o secret de mesmo nome no GitHub e não o envie ao repositório.
3. O `google-services.json` do Firebase fica em `artifacts/minas-mais-entregas/android/app/google-services.json` e precisa permanecer no repositório para o build do FCM.
4. Para o servidor enviar notificações, configure no Replit Secret `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON de uma conta de serviço do projeto Firebase `minas-mais-entregas`. O `google-services.json` do Android é uma configuração de cliente e não substitui essa credencial do servidor.
5. Abra **Actions → Android APK → Run workflow**. Após a execução verde, baixe o artefato `minas-mais-entregas-android-N` em **Artifacts**.

O keystore e as senhas de assinatura são dados permanentes: guarde uma cópia segura. Todos os APKs de atualização precisam usar a mesma chave de assinatura.
