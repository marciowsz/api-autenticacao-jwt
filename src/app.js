/**
 * Monta a aplicação Express. Banco e configurações são recebidos por
 * parâmetro, para que os testes usem um banco isolado e um segredo de teste.
 */
const express = require('express');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const { createDatabase } = require('./db/database');
const { seedProdutos } = require('./db/seed');
const { usuariosService } = require('./services/usuarios.service');
const { produtosService } = require('./services/produtos.service');
const { authRoutes } = require('./routes/auth.routes');
const { usuariosRoutes } = require('./routes/usuarios.routes');
const { produtosRoutes } = require('./routes/produtos.routes');
const { autenticar } = require('./middlewares/auth');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const { criarOpenApi } = require('./docs/openapi');

/** Banco padrão: já vem com os 150 produtos de exemplo */
function bancoComDadosDeExemplo() {
  const db = createDatabase();
  seedProdutos(db);
  return db;
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.config  { jwtSecret, jwtExpiresIn, bcryptRounds } (ver src/config/env.js)
 * @param {object} [opcoes.db]
 */
function createApp({ config, db = bancoComDadosDeExemplo() }) {
  const app = express();
  const usuarios = usuariosService(db, config);
  const produtos = produtosService(db);
  const exigirLogin = autenticar({ jwtSecret: config.jwtSecret, db });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  // Documentação: Swagger UI em /api-docs e o JSON puro em /api-docs.json
  const openapi = criarOpenApi();
  app.get('/api-docs.json', (req, res) => res.json(openapi));
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openapi, {
      customSiteTitle: 'API de Loja - Documentação',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  app.get('/', (req, res) => {
    res.json({
      api: 'API de Loja - Autenticação JWT, RBAC e Swagger',
      documentacao: '/api-docs',
      publicas: ['POST /register', 'POST /login', 'GET /produtos', 'GET /produtos/:id'],
      autenticadas: ['GET /perfil', 'GET /usuarios/:id', 'POST /produtos/:id/baixa-estoque'],
      somenteAdmin: [
        'GET /usuarios',
        'PATCH /usuarios/:id/perfil',
        'DELETE /usuarios/:id',
        'POST /produtos',
        'DELETE /produtos/:id',
      ],
    });
  });

  app.use('/', authRoutes(usuarios, exigirLogin));
  app.use('/usuarios', usuariosRoutes(usuarios, exigirLogin));
  app.use('/produtos', produtosRoutes(produtos, exigirLogin));

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.usuarios = usuarios; // usado pelo server.js para criar o primeiro admin
  return app;
}

module.exports = { createApp };
