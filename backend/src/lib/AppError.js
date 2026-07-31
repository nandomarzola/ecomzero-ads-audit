/**
 * Erro de aplicação com código estável para o cliente.
 * O handler central converte isso em { error, code } — stack trace nunca sai daqui.
 */
class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = AppError;
