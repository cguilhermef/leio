# Leio

PWA para registrar livros lidos, acompanhar páginas e cumprir a meta anual de leitura.
Angular 21 + Firebase (Auth, Firestore, Storage, Functions, Hosting) + OpenAI para ler capas e
fichas catalográficas.

## Estrutura

```
src/app/core       serviços (auth, estante, catálogo, social), cálculos e modelos
src/app/shared     componentes reutilizáveis (capa, lista grade/lista, registro de página)
src/app/pages      telas
functions/         Cloud Functions: registerUser, identifyCover, searchBook, fetchCover,
                   readCatalogCard, respondInvite, removeConnection
firestore.rules    regras de segurança do Firestore
storage.rules      regras do Storage (capas)
```

### Modelo de dados

| Caminho | Conteúdo |
| --- | --- |
| `books/{id}` | Catálogo compartilhado: título, autores, editora, ano, ISBN, páginas, capa |
| `users/{uid}` | Perfil e `connections` (conexões mútuas) |
| `users/{uid}/shelf/{bookId}` | Livro na estante: status, página atual, páginas lidas, leituras concluídas |
| `users/{uid}/logs/{id}` | Registros de leitura (data e páginas lidas), base das estatísticas |
| `users/{uid}/goals/{ano}` | Meta de livros do ano e livros excluídos da meta |
| `invites/{id}` | Convites de compartilhamento por email |
| `recommendations/{id}` | Indicações de livros |
| `meta/limits` | Contador de usuários (limite de vagas) |

### Regras de negócio

O catálogo das regras (`RN-xx`), com onde cada uma é aplicada e os pontos de tensão em aberto,
está em [docs/regras-de-negocio.md](docs/regras-de-negocio.md). Leia antes de mudar uma regra.

- **Editores do catálogo** (RN-06): o custom claim `role: 'editor'` é definido pelo script abaixo,
  com o JSON da conta de serviço do projeto salvo na raiz (fora do git) e o `npm install` das
  functions feito:
  ```sh
  npm run editor -- add maria@exemplo.com
  npm run editor -- remove maria@exemplo.com
  npm run editor -- list
  ```
  O papel novo vale na próxima vez que a pessoa abrir o app.

## Configuração inicial

1. **Criar o projeto Firebase** em https://console.firebase.google.com (por exemplo, `leio-app`)
   e ativar o plano **Blaze**, necessário para Cloud Functions e chamadas à OpenAI.
2. No console, ativar:
   - **Authentication** > Provedor **Google**.
   - **Firestore Database** (modo produção, região `southamerica-east1`).
   - **Storage**.
3. Registrar um **App da Web** e copiar a configuração para
   [src/environments/environment.ts](src/environments/environment.ts).
4. Ajustar o ID do projeto em [.firebaserc](.firebaserc).
5. Configurar a chave da OpenAI como segredo:
   ```sh
   firebase functions:secrets:set OPENAI_API_KEY
   ```
   Para as capas, ative a **Books API** no Google Cloud Console (APIs e serviços > Biblioteca),
   crie uma chave de API restrita a ela (APIs e serviços > Credenciais) e guarde como segredo:
   ```sh
   firebase functions:secrets:set GOOGLE_BOOKS_API_KEY
   ```
6. Em Authentication > Configurações > Domínios autorizados, incluir o domínio de produção, se
   usar um domínio próprio.

Parâmetros das functions, definidos em [functions/.env](functions/.env) (obrigatório para o deploy não interativo):

| Parâmetro | Padrão | Uso |
| --- | --- | --- |
| `OPENAI_MODEL` | `gpt-5-mini` | Modelo com visão usado na leitura das fotos |
| `MAX_USERS` | `50` | Limite de usuários com acesso |
| `AI_DAILY_LIMIT` | `40` | Leituras de foto por usuário por dia |

## Desenvolvimento

```sh
npm install
cd functions && npm install && cd ..
npm start          # app em http://localhost:4200
npm test           # testes unitários
```

## Deploy

O workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publica Hosting,
Functions, regras e índices a cada push na branch `main`. No repositório do GitHub, configure:

- **Variável** `FIREBASE_PROJECT_ID`: ID do projeto Firebase.
- **Segredo** `FIREBASE_SERVICE_ACCOUNT`: JSON de uma conta de serviço do projeto com os papéis
  *Firebase Admin*, *Cloud Functions Admin*, *Service Account User*, *Secret Manager Admin*,
  *Cloud Build Editor* e *Artifact Registry Administrator*.

Deploy manual: `npx firebase-tools deploy`.
