module.exports = {
  apps: [
    {
      name: 'chef-cuisine',
      script: 'server/index.js',
      cwd: '/home/user/webapp',
      env: { NODE_ENV: 'production', PORT: 3000, HOST: '0.0.0.0' },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
    },
  ],
};
