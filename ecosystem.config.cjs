module.exports = {
  apps: [
    {
      name: "kapruka-web",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_memory_restart: "512M",
    },
    {
      name: "kapruka-relay",
      script: "npm",
      args: "run relay:start",
      env: {
        NODE_ENV: "production",
        VOICE_RELAY_HOST: "127.0.0.1",
        VOICE_RELAY_PORT: "8787",
      },
      max_memory_restart: "512M",
    },
  ],
};
