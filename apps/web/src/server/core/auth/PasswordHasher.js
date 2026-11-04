import bcrypt from 'bcryptjs';

/** Comparación de contraseñas con bcrypt (compatible con `crypt(..., gen_salt('bf'))` de pgcrypto). */
export class PasswordHasher {
  #hashSenuelo;

  constructor({ costo = 10 } = {}) {
    // Hash señuelo: si el usuario no existe se compara igual, para no filtrar
    // por tiempo de respuesta qué usuarios existen.
    this.#hashSenuelo = bcrypt.hashSync('senuelo-no-usar', costo);
  }

  /** @param {string} plano @param {string|null|undefined} hash */
  async coincide(plano, hash) {
    return bcrypt.compare(plano, hash ?? this.#hashSenuelo);
  }
}
