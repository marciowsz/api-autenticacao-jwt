# API Segura: Autenticação JWT, RBAC e Swagger

Entregável da **Semana 7** de Desenvolvimento de APIs e Backend. Evolui a API das Semanas 5 e 6 ([validação e erros](https://github.com/marciowsz/api-validacao-erros), [paginação e filtros](https://github.com/marciowsz/api-paginacao-filtros)) com:
- **registro de usuários com senha em hash bcrypt**;
- **login com JWT**;
- **middleware de autenticação**;
- **controle de acesso por perfil (RBAC)**;
- **documentação Swagger/OpenAPI** com Bearer Auth.

**Autor:** Marcio Rogério Reis Freire Junior ([@marciowsz](https://github.com/marciowsz))

[![CI](https://github.com/marciowsz/api-autenticacao-jwt/actions/workflows/ci.yml/badge.svg)](https://github.com/marciowsz/api-autenticacao-jwt/actions/workflows/ci.yml)

## Como rodar

Requisito: **Node.js 22.13 ou mais novo**.

```bash
npm install
cp .env.example .env     # defina o JWT_SECRET e a senha do admin
npm start                # http://localhost:3000
npm test                 # 64 testes
```

- **Swagger UI:** http://localhost:3000/api-docs (o JSON está em `/api-docs.json`)
- **Requisições prontas:** [`requests.http`](requests.http)

> A API **não sobe** sem um `JWT_SECRET` de pelo menos 32 caracteres. O `.env` está no `.gitignore`, então nenhum segredo vai para o GitHub. Só o [`.env.example`](.env.example), sem valores reais, é versionado.

## Arquivos principais (rotas e configurações)

| Arquivo | Papel |
|---|---|
| [`src/routes/auth.routes.js`](src/routes/auth.routes.js) | `POST /register`, `POST /login`, `GET /perfil` |
| [`src/routes/usuarios.routes.js`](src/routes/usuarios.routes.js) | Rotas administrativas de usuários |
| [`src/routes/produtos.routes.js`](src/routes/produtos.routes.js) | Catálogo (leitura pública, escrita admin) |
| [`src/middlewares/auth.js`](src/middlewares/auth.js) | `autenticar` (JWT → 401) e `autorizar('admin')` (RBAC → 403) |
| [`src/services/usuarios.service.js`](src/services/usuarios.service.js) | Hash bcrypt, login e geração do token |
| [`src/docs/openapi.js`](src/docs/openapi.js) | Documentação OpenAPI 3 |
| [`src/config/env.js`](src/config/env.js) e [`.env.example`](.env.example) | Configuração por variáveis de ambiente |
| [`test/auth.test.js`](test/auth.test.js) | Testes de autenticação, RBAC e Swagger |

## Mapa de acesso

| Rota | Pública | Logado (`comum`) | `admin` |
|---|:-:|:-:|:-:|
| `POST /register`, `POST /login` | ✅ | ✅ | ✅ |
| `GET /produtos`, `GET /produtos/:id` | ✅ | ✅ | ✅ |
| `GET /perfil` | 401 | ✅ | ✅ |
| `POST /produtos/:id/baixa-estoque` (compra) | 401 | ✅ | ✅ |
| `GET /usuarios/:id` | 401 | ✅ só o próprio (outro: 403) | ✅ |
| `GET /usuarios` | 401 | **403** | ✅ |
| `PATCH /usuarios/:id/perfil` | 401 | **403** | ✅ |
| `DELETE /usuarios/:id` | 401 | **403** | ✅ |
| `POST /produtos`, `DELETE /produtos/:id` | 401 | **403** | ✅ |

---

## Parte 1: Usuários, registro e segurança de senhas

Tabela `usuarios`: `id`, `nome`, `email` (**único**, sem diferenciar maiúsculas), `senha_hash` e `perfil` (`'comum'` ou `'admin'`, com `CHECK` no banco).

- **`POST /register`** é pública. Valida nome, e-mail e senha (mínimo 8 caracteres, com letras e números) e cria o usuário **sempre** com perfil `comum`. Enviar `"perfil": "admin"` é recusado com 400 "Campo não permitido".
- **Hash bcrypt:** a senha passa por `bcrypt.hash(senha, 10)` **antes** de ir para o banco. Fica gravado algo como `$2a$10$N9qo8uLOickgx2ZMRZoMye...`: um hash de **mão única**, com **salt aleatório** (a mesma senha gera hashes diferentes) e **lento de propósito**, para atrapalhar ataques de força bruta.
- **A senha nunca é retornada:** uma única função (`toUsuario`) converte a linha do banco em resposta, e ela não inclui `senha_hash`. Há testes conferindo isso em `/register`, `/perfil` e `/usuarios`.
- O **primeiro admin** é criado ao subir a API, com `ADMIN_EMAIL` e `ADMIN_SENHA` do `.env`. Depois, um admin pode promover outros usuários com `PATCH /usuarios/:id/perfil`.

```json
POST /register   { "nome": "Ana Souza", "email": "ana@email.com", "senha": "SenhaForte123" }

HTTP/1.1 201 Created
{ "id": 2, "nome": "Ana Souza", "email": "ana@email.com", "perfil": "comum", "criadoEm": "2026-11-24T19:40:00.000Z" }
```

---

## Parte 2: Login e proteção com JWT

**`POST /login`** busca o usuário pelo e-mail e compara a senha enviada com o hash (`bcrypt.compare`). Se estiver certa, gera um **JWT** assinado com o `JWT_SECRET` (HS256, validade de 1h):

```json
HTTP/1.1 200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwZXJmaWwiOiJjb211bSIsImlhdCI6...",
  "tokenType": "Bearer",
  "expiresIn": "1h",
  "expiresAt": "2026-11-24T20:40:00.000Z",
  "usuario": { "id": 2, "nome": "Ana Souza", "email": "ana@email.com", "perfil": "comum", "criadoEm": "..." }
}
```

O payload do token tem só o **id do usuário** (`sub`) e o **perfil**, além de `iat` e `exp`. Nada de senha ou dado sensível, porque o payload de um JWT é apenas codificado em base64, não criptografado.

Login errado devolve **sempre a mesma resposta**, seja a senha errada ou o e-mail inexistente. Assim ninguém descobre quais e-mails têm conta. O tempo de resposta também é o mesmo nos dois casos.

```json
HTTP/1.1 401 Unauthorized
{ "status": 401, "error": "INVALID_CREDENTIALS", "message": "E-mail ou senha incorretos.", "details": [], "timestamp": "..." }
```

**Middleware de autenticação** ([`auth.js`](src/middlewares/auth.js)) para rotas privadas como `GET /perfil`:
1. Exige o cabeçalho `Authorization: Bearer <token>`.
2. Confere a **assinatura** e a **expiração** com `jwt.verify` (só aceita `HS256`, o que bloqueia o ataque `"alg": "none"`).
3. Confere se o usuário **ainda existe** e lê o perfil **atual** do banco. Um usuário excluído ou rebaixado perde o acesso na hora, mesmo com um token antigo.

| Situação | Resposta |
|---|---|
| Sem o cabeçalho `Authorization` | 401 `UNAUTHORIZED` |
| Sem o prefixo `Bearer` | 401 `UNAUTHORIZED` |
| Token adulterado ou de outro segredo | 401 `INVALID_TOKEN` |
| Token expirado | 401 `TOKEN_EXPIRED` |
| Usuário do token excluído | 401 `INVALID_TOKEN` |

```json
GET /perfil   (sem token)

HTTP/1.1 401 Unauthorized
{
  "status": 401,
  "error": "UNAUTHORIZED",
  "message": "Token de autenticação não informado.",
  "details": [ { "field": "Authorization", "message": "Envie o cabeçalho Authorization: Bearer <token>." } ],
  "timestamp": "..."
}
```

---

## Parte 3: Desafio

### RBAC: controle de acesso por perfil

O segundo middleware, `autorizar('admin')`, roda **depois** do `autenticar` e confere o perfil:

```js
router.delete('/:id', autorizar('admin'), validate(idParamSchema, 'params'), (req, res) => { ... });
```

```json
DELETE /usuarios/1   Authorization: Bearer <token de usuário comum>

HTTP/1.1 403 Forbidden
{
  "status": 403,
  "error": "FORBIDDEN",
  "message": "Você não tem permissão para acessar este recurso.",
  "details": [ { "field": "perfil", "message": "Necessário perfil: admin." } ],
  "timestamp": "..."
}
```

> **401 × 403:** o 401 indica que a API não sabe quem você é (faltou token ou ele é inválido). O 403 indica que a API sabe quem você é, mas você não tem permissão.

Regras extras: um admin não pode excluir a própria conta (422, para evitar ficar sem administrador), e um usuário comum pode ver o próprio cadastro, mas não o de outra pessoa (403).

### Documentação Swagger / OpenAPI

Disponível em **`/api-docs`**, com todas as rotas, parâmetros, corpos de entrada, schemas de resposta e exemplos dos erros 401 e 403. Rotas protegidas aparecem com um **cadeado**.

**Testando com token no Swagger:**
1. Abra `POST /login` → **Try it out** → **Execute** e copie o `token` da resposta.
2. Clique em **Authorize** (cadeado no topo), cole o token e confirme.
3. Agora as rotas protegidas (`/perfil`, `/usuarios`...) funcionam direto pela interface. O token fica salvo mesmo ao recarregar a página (`persistAuthorization`).

### Testes

`npm test` roda **64 testes**: 34 desta semana e os das semanas anteriores, adaptados para o login. Eles cobrem:
- hash e salt da senha;
- senha nunca retornada;
- token adulterado, de outro segredo, `alg: none`, expirado e de usuário excluído;
- 401 antes do 400;
- 403 para cada rota de admin;
- perfil lido do banco;
- disponibilidade do Swagger e Bearer Auth documentado.

---

## Parte 4: Reflexão

### Por que armazenar senhas em texto plano (ou com criptografia reversível) é uma das maiores falhas de segurança de um sistema? E por que a documentação via Swagger/OpenAPI não é apenas uma "formalidade", mas sim uma ferramenta de segurança e agilidade para a equipe de desenvolvimento?

**Senhas.** Vazamentos de banco de dados acontecem: SQL Injection, backup exposto, servidor mal configurado, funcionário mal-intencionado. A pergunta não é se o banco pode vazar, e sim **o que o atacante consegue fazer quando vazar**.

- Com **texto plano**, o atacante tem na hora a senha de todos os usuários. Como a maioria das pessoas **repete a mesma senha** em vários serviços, o estrago vai além do nosso sistema: e-mail, banco e redes sociais dos usuários ficam expostos (*credential stuffing*). Funcionários com acesso ao banco também veem as senhas, e a empresa responde pela **LGPD**.
- Com **criptografia reversível** (AES, por exemplo), o problema só muda de lugar: em algum servidor existe a **chave** que decifra tudo. Se ela vazar junto, e normalmente ela está no mesmo servidor, todas as senhas são recuperadas de uma vez.
- O **hash** é de **mão única**: não existe "des-hash". No login, o sistema não decifra nada. Ele **calcula o hash da senha digitada e compara**. Mesmo com o banco vazado, o atacante só tem hashes. O **bcrypt** ainda acrescenta um **salt** aleatório, para que senhas iguais gerem hashes diferentes e tabelas pré-calculadas (*rainbow tables*) sejam inúteis, e um **custo** proposital: cada tentativa é lenta, e testar bilhões de senhas fica inviável.

Por isso nem o administrador do sistema consegue ver a senha de um usuário. O correto é oferecer "redefinir senha", nunca "lembrar senha".

**Swagger/OpenAPI.** A documentação é o **contrato** da API, gerado a partir de um arquivo versionado junto com o código. Ela não é um PDF esquecido numa pasta:

- **Agilidade:** o frontend, o time mobile ou um parceiro descobre sozinho quais rotas existem, quais campos enviar, quais respostas e erros esperar, sem reuniões e sem ler o código. O **Try it out** com o botão **Authorize** permite testar login e rotas protegidas em segundos, direto no navegador. A integração tem menos erros de "campo com nome errado" ou "achei que era opcional".
- **Segurança:** a documentação deixa **explícito** quais rotas exigem token (cadeado), quais exigem perfil admin (resposta 403 documentada) e que a senha nunca aparece nas respostas (o schema `Usuario` não tem esse campo). Isso facilita **revisar** se alguma rota sensível ficou sem proteção. Uma rota que existe no código mas não no contrato é um sinal de alerta. O contrato também padroniza o uso correto de `Authorization: Bearer`, evitando soluções inseguras como token na URL.
- **Qualidade e manutenção:** novos desenvolvedores aprendem a API rápido, e o OpenAPI permite gerar clientes automaticamente, criar *mocks* e rodar testes de contrato.

Documentar a API reduz erros de integração, ajuda a encontrar falhas de segurança e acelera o time inteiro.
