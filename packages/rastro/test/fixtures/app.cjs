// Simula uma API Adonis 5 (CommonJS) carregada com -r @rodrigoclc/rastro/register
const http = require("node:http")
const pino = require('pino')
const { createOtelMiddleware } = require('@rodrigoclc/rastro/adonis')

const logger = pino()
const Middleware = createOtelMiddleware({ attributes: () => ({ 'organization.id': '7' }) })
const middleware = new Middleware()

const server = http.createServer(async (req, res) => {
  const ctx = { request: { method: () => req.method }, route: null, auth: { user: { id: 42 } } }
  await middleware.handle(ctx, async () => {
    // Como no Adonis: a rota é resolvida dentro da cadeia e a resposta
    // só é escrita depois que todos os middlewares terminam.
    ctx.route = { pattern: '/calculations/:id' }
    logger.error('falha ao gerar pdf')
    res.statusCode = 500
  })
  res.end('erro')
})

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  await fetch(`http://127.0.0.1:${port}/calculations/42`)
  await fetch(`http://127.0.0.1:${port}/health`)
  server.close()
  process.kill(process.pid, 'SIGTERM')
})
