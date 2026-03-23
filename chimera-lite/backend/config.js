require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  API_TOKEN: process.env.API_TOKEN,
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me',
  LICENSE_SESSION_TTL_MS: Number(process.env.LICENSE_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000),
  ADMIN_SESSION_TTL_MS: Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
  // Ordered cheapest-first. startPod() walks this list until one succeeds.
  RUNPOD_GPU_FALLBACK_CHAIN: [
    'NVIDIA GeForce RTX 5090',
    'NVIDIA L40S',
    'NVIDIA A100 80GB SXM',
    'NVIDIA H100 80GB HBM3',
  ],
  RUNPOD_TEMPLATE_ID: process.env.RUNPOD_TEMPLATE_ID,
  // RUNPOD_NETWORK_VOLUME_ID: process.env.RUNPOD_NETWORK_VOLUME_ID || null,
  // Volume commented out — no longer used (region-locks GPU availability).
  RUNPOD_WARM_POD_ID: process.env.RUNPOD_WARM_POD_ID || null,
  RUNPOD_CONTAINER_DISK_GB: 40,
  SESSION_STATE_FILE: process.env.SESSION_STATE_FILE || '.session-state.json',
  SESSION_TIMEOUT_MS: 3 * 60 * 60 * 1000, // 3 hours
};
