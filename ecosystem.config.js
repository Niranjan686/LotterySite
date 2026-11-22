module.exports = {
  apps: [
    {
      name: 'royal-palms-lottery',
      script: 'backend/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        HOST: '0.0.0.0',
        AUTO_SEED_DEMO: 'true'
      }
    }
  ]
};
