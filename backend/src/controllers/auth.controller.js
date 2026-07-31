const { z } = require('zod');
const authService = require('../services/auth.service');

const registerSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres').max(128),
  name: z.string().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
});

async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    res.status(201).json(await authService.register(data));
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);
    res.json(await authService.login(data));
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    res.json({ user: await authService.findById(req.user.id) });
  } catch (err) {
    next(err);
  }
}

function logout(_req, res) {
  res.status(204).end();
}

module.exports = { register, login, me, logout };
