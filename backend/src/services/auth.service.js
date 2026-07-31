const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const AppError = require('../lib/AppError');

const BCRYPT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH = '$2a$10$ZlunYqGtQstaa92ZqZpUWuy5PzHQFMzR/GGsTl3y7mfvmzW0LOv4q';

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' },
  );
}

async function register({ email, password, name }) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AppError('E-mail já cadastrado', { status: 409, code: 'email_taken' });
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name: name?.trim() || null,
    },
  });

  return { user: publicUser(user), token: signToken(user) };
}

async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Mensagem idêntica nos dois casos — não revela se o e-mail existe.
  const invalid = new AppError('E-mail ou senha inválidos', {
    status: 401,
    code: 'invalid_credentials',
  });

  if (!user) {
    // Hash descartável para igualar o tempo de resposta ao caminho com usuário real.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw invalid;
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) throw invalid;

  return { user: publicUser(user), token: signToken(user) };
}

async function findById(id) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('Usuário não encontrado', { status: 404, code: 'user_not_found' });
  return publicUser(user);
}

module.exports = {
  register,
  login,
  findById,
  publicUser,
  signToken,
  DUMMY_PASSWORD_HASH,
};
