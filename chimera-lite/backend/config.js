require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  API_TOKEN: process.env.API_TOKEN,
  RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
  RUNPOD_GPU_TYPE: process.env.RUNPOD_GPU_TYPE || 'NVIDIA GeForce RTX 4090',
  RUNPOD_TEMPLATE_ID: process.env.RUNPOD_TEMPLATE_ID,
  RUNPOD_CONTAINER_DISK_GB: 5,
  SESSION_TIMEOUT_MS: 3 * 60 * 60 * 1000, // 3 hours
};
