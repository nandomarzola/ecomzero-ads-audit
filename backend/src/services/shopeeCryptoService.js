const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const env = require('../config/env');

const PREFIX = 'enc:v1:';

function encryptionKey() {
  const raw = env.requireTokenEncryptionKey();
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error('TOKEN_ENCRYPTION_KEY precisa ter exatamente 64 caracteres hexadecimais');
  }
  return Buffer.from(raw, 'hex');
}

function encrypt(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Token vazio não pode ser criptografado');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) {
    throw new Error('Token Shopee não está no formato criptografado enc:v1:');
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Token Shopee criptografado está malformado');
  const [ivHex, tagHex, ciphertextHex] = parts;
  if (!/^[a-fA-F0-9]{24}$/.test(ivHex)
    || !/^[a-fA-F0-9]{32}$/.test(tagHex)
    || !/^[a-fA-F0-9]+$/.test(ciphertextHex)
    || ciphertextHex.length % 2 !== 0) {
    throw new Error('Token Shopee criptografado está malformado');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt, PREFIX };
