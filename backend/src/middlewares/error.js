const { ZodError } = require('zod');
const AppError = require('../lib/AppError');

// 404 para rotas não registradas — cai no formato padrão de erro
function notFound(req, res, next) {
  next(new AppError(`Rota não encontrada: ${req.method} ${req.path}`, {
    status: 404,
    code: 'not_found',
  }));
}

/**
 * Handler central. Toda falha vira { error: string, code: string }.
 * Stack trace só vai para o log — nunca para o cliente.
 */
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(422).json({
      error: 'Dados inválidos',
      code: 'validation_error',
      details,
    });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`[${err.code}]`, err.stack);
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Violação de unique do Prisma — o caso comum é e-mail duplicado
  if (err?.code === 'P2002') {
    return res.status(409).json({
      error: 'Registro já existe',
      code: 'conflict',
      details: { fields: err.meta?.target ?? [] },
    });
  }

  console.error('[unhandled]', err?.stack ?? err);
  return res.status(500).json({
    error: 'Erro interno do servidor',
    code: 'internal_error',
  });
}

module.exports = { notFound, errorHandler };
