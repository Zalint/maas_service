const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const tenant = require('../config/tenant');

let sequelize;

// Read environment variables from file (local) or system environment (production)
let envVars = {};

if (process.env.NODE_ENV === 'production') {
  // In production, use system environment variables
  envVars = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    DB_SSL: process.env.DB_SSL
  };
} else {
  // In local development, read from .env.local file but let any
  // already-set process.env values WIN. This lets shell overrides like
  // `$env:DB_NAME='maas_shared_dev'` work for one-off testing without
  // editing the file.
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8')
      .replace(/^\uFEFF/, '')  // Remove BOM if present
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\r/g, '\n');   // Normalize line endings

    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split('=');
        if (key && value) {
          envVars[key.trim()] = value.trim();
        }
      }
    });
  } catch (error) {
    console.log('No .env.local file found, using system environment variables');
  }

  // Process env always wins over .env.local \u2014 same precedence dotenv
  // would give us. Critical for shell-driven multi-tenant testing.
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL']) {
    if (process.env[k] !== undefined && process.env[k] !== '') {
      envVars[k] = process.env[k];
    }
  }
}

// Environment variables parsed successfully (sensitive data not logged for security)

const commonOptions = {
  dialect: 'postgres',
  logging: false,
  // CRITIQUE: Sequelize.sync() ignore le SET search_path de la session
  // (vu en debug: search_path=mbao mais Category.sync() crée la table dans
  // public). On force le schéma par défaut côté `define` pour que toutes
  // les CREATE TABLE générées par sync() ciblent le bon schéma.
  // Quand DB_SCHEMA est non défini → tenant.schema='public' → no-op.
  define: tenant.schema && tenant.schema !== 'public'
    ? { schema: tenant.schema }
    : {},
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  hooks: {
    // Constrain every query on this connection to the tenant's schema.
    // The trailing 'public' keeps shared catalogs (extensions, sequences
    // belonging to global tables) visible. Identifiers are double-quoted
    // to defend against any unusual characters in the schema name.
    //
    // When DB_SCHEMA is unset, tenant.schema === 'public' and this
    // statement is a harmless no-op (search_path defaults to public).
    afterConnect: async (connection) => {
      // Set search_path to the tenant schema ONLY. Do not include 'public'
      // as a fallback — that would let queries silently read another
      // tenant's data when this tenant's schema doesn't have the table
      // yet (e.g. between CREATE SCHEMA and Sequelize's CREATE TABLE).
      // Identifier double-quoted to defend against unusual chars.
      try {
        await connection.query(`SET search_path TO "${tenant.schema}"`);
      } catch (err) {
        console.error(
          `[db] failed to SET search_path to "${tenant.schema}":`,
          err.message
        );
        throw err;
      }
    }
  }
};

if (process.env.DATABASE_URL) {
  console.log('Initializing Sequelize with DATABASE_URL...');
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    ...commonOptions,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });
} else {
  console.log('Initializing Sequelize with individual variables...');
  const useSSL = envVars.DB_SSL === 'true';
  
  sequelize = new Sequelize({
    ...commonOptions,
    host: envVars.DB_HOST,
    port: envVars.DB_PORT || 5432,
    username: envVars.DB_USER,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_NAME,
    dialectOptions: useSSL ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {}
  });
}

// Test connection function
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    return true;
  } catch (error) {
    console.error('Unable to connect to the database:', error.message);
    console.error('Please verify database configuration and connectivity');
    return false;
  }
}

module.exports = {
  sequelize,
  testConnection
}; 